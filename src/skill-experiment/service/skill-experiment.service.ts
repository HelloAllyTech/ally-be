import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { PromptsService } from 'src/prompt/service/prompt.service';
import { SkillExperiment } from '../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../entity/skill-experiment-variant.entity';
import { SkillExperimentObservation } from '../entity/skill-experiment-observation.entity';
import { SkillExperimentEvent } from '../entity/skill-experiment-event.entity';
import {
  SkillExperimentEventType,
  SkillExperimentStatus,
  SkillObservationStatus,
} from '../enum/skill-experiment.enum';
import {
  CONNECTED_SKILLS,
  ConnectedSkill,
  SKILL_EXPERIMENT_DEFAULTS,
  isConnectedSkill,
} from '../constants/skill-experiment.constants';
import {
  ConfigureSkillExperimentDto,
  SkillExperimentObservationsQueryDto,
} from '../dto/skill-experiment.dto';
import { extractPlaceholderTokens } from '../util/placeholder-lock.util';
import { SkillExperimentStateService } from './skill-experiment-state.service';
import { SkillExperimentRouterService } from './skill-experiment-router.service';

const LIVE = [
  SkillExperimentStatus.BASELINE,
  SkillExperimentStatus.TESTING,
  SkillExperimentStatus.PAUSED,
];

export interface ConnectedSkillRow {
  promptId: string | null;
  promptCode: string;
  name: string;
  description: string;
  runtime: ConnectedSkill['runtime'];
  outputDescription: string;
  experiment: ExperimentSummary | null;
}

export interface ExperimentSummary {
  id: string;
  status: SkillExperimentStatus;
  pausedReason: string | null;
  run: number;
  targetScore: number;
  championLabel: string | null;
  championScore: number | null;
  originalScore: number | null;
  championJudged: number;
  challengerLabel: string | null;
  variantsDrafted: number;
  lastTickAt: Date | null;
  updatedAt: Date;
}

/**
 * Everything an admin does to an experiment. Transitions go through
 * SkillExperimentStateService so the admin and the loop share one rulebook.
 */
@Injectable()
export class SkillExperimentService {
  constructor(
    private readonly state: SkillExperimentStateService,
    private readonly router: SkillExperimentRouterService,
    private readonly promptsService: PromptsService,
    @InjectRepository(Prompt)
    private readonly prompts: Repository<Prompt>,
  ) {}

  private get experiments(): Repository<SkillExperiment> {
    return this.state.experiments;
  }
  private get variants(): Repository<SkillExperimentVariant> {
    return this.state.variants;
  }
  private get observations(): Repository<SkillExperimentObservation> {
    return this.state.observations;
  }
  private get events(): Repository<SkillExperimentEvent> {
    return this.state.events;
  }

  /** Every connected skill, with its experiment if one exists — the Experiments tab. */
  async listConnected(): Promise<ConnectedSkillRow[]> {
    const codes = Object.keys(CONNECTED_SKILLS);
    const prompts = await this.prompts.find({
      where: { promptCode: In(codes) },
    });
    const byCode = new Map(prompts.map((p) => [p.promptCode, p]));
    const experiments = prompts.length
      ? await this.experiments.find({
          where: { promptId: In(prompts.map((p) => p.id)) },
        })
      : [];
    const summaries = await this.summarize(experiments);

    return codes.map((code) => {
      const prompt = byCode.get(code);
      const experiment = prompt
        ? experiments.find((e) => e.promptId === prompt.id)
        : undefined;
      return {
        promptId: prompt?.id ?? null,
        promptCode: code,
        name: prompt?.name ?? code,
        description: prompt?.description ?? '',
        runtime: CONNECTED_SKILLS[code].runtime,
        outputDescription: CONNECTED_SKILLS[code].outputDescription,
        experiment: experiment ? (summaries.get(experiment.id) ?? null) : null,
      };
    });
  }

  /** The drawer: config, every variant of every run, recent timeline, spend. */
  async getDetail(promptId: string) {
    const prompt = await this.requirePrompt(promptId);
    const connected = CONNECTED_SKILLS[prompt.promptCode] ?? null;
    const experiment = await this.experiments.findOneBy({ promptId });
    const skillText =
      (await this.state.currentSkillText(prompt.promptCode)) ?? '';

    if (!experiment) {
      return {
        prompt: promptView(prompt),
        connected,
        lockedPlaceholders: extractPlaceholderTokens(skillText),
        experiment: null,
        defaults: {
          ...SKILL_EXPERIMENT_DEFAULTS,
          rubric: connected?.suggestedRubric ?? [],
        },
        variants: [],
        events: [],
        spend: null,
      };
    }

    const [variants, events, spend, pendingCount] = await Promise.all([
      this.variants.find({
        where: { experimentId: experiment.id },
        order: { run: 'DESC', ordinal: 'ASC' },
      }),
      this.events.find({
        where: { experimentId: experiment.id },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.spend(experiment.id),
      this.observations.count({
        where: {
          experimentId: experiment.id,
          status: SkillObservationStatus.PENDING,
        },
      }),
    ]);

    return {
      prompt: promptView(prompt),
      connected,
      lockedPlaceholders: extractPlaceholderTokens(skillText),
      experiment: { ...experiment, pendingCount },
      defaults: {
        ...SKILL_EXPERIMENT_DEFAULTS,
        rubric: connected?.suggestedRubric ?? [],
      },
      variants,
      events,
      spend,
    };
  }

  async configure(
    promptId: string,
    dto: ConfigureSkillExperimentDto,
  ): Promise<SkillExperiment> {
    const prompt = await this.requirePrompt(promptId);
    this.requireConnected(prompt);
    const actorId = currentUserId();
    let experiment = await this.experiments.findOneBy({ promptId });
    const live = !!experiment && LIVE.includes(experiment.status);

    if (live) {
      const rubricChanged =
        dto.rubric !== undefined &&
        JSON.stringify(dto.rubric) !== JSON.stringify(experiment!.rubric);
      const judgeChanged =
        dto.judgeModel !== undefined &&
        (dto.judgeModel || null) !== (experiment!.judgeModel ?? null);
      if (rubricChanged || judgeChanged) {
        throw new ConflictException(
          'Turn the experiment off before changing the rubric or the judge model — ' +
            'scores from a different rubric or judge cannot be compared with the ones collected so far.',
        );
      }
    }
    if (dto.rubric) assertUniqueKeys(dto.rubric);

    if (!experiment) {
      experiment = this.experiments.create({
        promptId,
        promptCode: prompt.promptCode,
        status: SkillExperimentStatus.OFF,
        run: 0,
        rubric: CONNECTED_SKILLS[prompt.promptCode].suggestedRubric,
        ...SKILL_EXPERIMENT_DEFAULTS,
      });
    }

    const { judgeModel, designerModel, ...rest } = dto;
    Object.assign(experiment, rest);
    if (judgeModel !== undefined) experiment.judgeModel = judgeModel || null;
    if (designerModel !== undefined)
      experiment.designerModel = designerModel || null;
    experiment.updatedBy = actorId;

    const saved = await this.experiments.save(experiment);
    await this.state.logEvent(
      saved.id,
      SkillExperimentEventType.CONFIGURED,
      'Settings updated.',
      { actorId, metadata: { fields: Object.keys(dto) } },
    );
    this.router.invalidate();
    return saved;
  }

  /** Turn auto-improve on: snapshot the skill text and start collecting a baseline. */
  async start(promptId: string) {
    const prompt = await this.requirePrompt(promptId);
    this.requireConnected(prompt);
    const experiment = await this.experiments.findOneBy({ promptId });
    if (!experiment) {
      throw new BadRequestException(
        'Save a rubric before turning auto-improve on.',
      );
    }
    if (experiment.status !== SkillExperimentStatus.OFF) {
      throw new ConflictException('Auto-improve is already on for this skill.');
    }
    if (!experiment.rubric?.length) {
      throw new BadRequestException(
        'Add at least one rubric criterion before turning auto-improve on.',
      );
    }
    const text = await this.state.currentSkillText(prompt.promptCode);
    if (!text) {
      throw new BadRequestException('This skill has no text to experiment on.');
    }

    const actorId = currentUserId();
    const started = await this.state.beginRun(
      experiment,
      text,
      [SkillExperimentStatus.OFF],
      {
        type: SkillExperimentEventType.STARTED,
        message:
          `Auto-improve turned on. Collecting ${experiment.minSamplesPerVariant} judged ` +
          'outputs of the original before drafting the first variant.',
        actorId,
      },
    );
    if (!started) {
      throw new ConflictException(
        'The experiment changed state — refresh and try again.',
      );
    }
    return this.getDetail(promptId);
  }

  /** Turn auto-improve off: the skill serves its own text again immediately. */
  async stop(promptId: string) {
    const experiment = await this.requireExperiment(promptId);
    if (experiment.status === SkillExperimentStatus.OFF) {
      return this.getDetail(promptId);
    }
    const actorId = currentUserId();
    const stopped = await this.state.guardedUpdate(experiment, LIVE, {
      status: SkillExperimentStatus.OFF,
      pausedReason: null,
      championVariantId: null,
      challengerVariantId: null,
      updatedBy: actorId,
    });
    if (stopped) {
      await this.state.abandonPending(experiment.id);
      await this.state.retireLiveVariants(
        experiment,
        'Auto-improve was turned off.',
      );
      await this.state.logEvent(
        experiment.id,
        SkillExperimentEventType.STOPPED,
        'Auto-improve turned off. The skill serves its own text again.',
        { actorId },
      );
      this.router.invalidate();
    }
    return this.getDetail(promptId);
  }

  /** Continue a paused loop with a fresh variant budget. */
  async resume(promptId: string) {
    const experiment = await this.requireExperiment(promptId);
    if (experiment.status !== SkillExperimentStatus.PAUSED) {
      throw new ConflictException('Only a paused experiment can be resumed.');
    }
    const actorId = currentUserId();
    const resumed = await this.state.guardedUpdate(
      experiment,
      [SkillExperimentStatus.PAUSED],
      {
        status: SkillExperimentStatus.TESTING,
        pausedReason: null,
        pausedAt: null,
        variantsDrafted: 0,
        consecutiveLosses: 0,
        designFailures: 0,
        updatedBy: actorId,
      },
    );
    if (resumed) {
      await this.state.logEvent(
        experiment.id,
        SkillExperimentEventType.RESUMED,
        `Resumed with a fresh budget of ${experiment.maxVariants} variants, aiming for ${experiment.targetScore}.`,
        { actorId },
      );
      this.router.invalidate();
    }
    return this.getDetail(promptId);
  }

  /**
   * Make the best version the skill's own text: a new System Skills version
   * (dashboard override on), then turn the experiment off. From here the skill
   * serves the applied text with or without an experiment.
   */
  async apply(promptId: string) {
    const experiment = await this.requireExperiment(promptId);
    if (
      ![SkillExperimentStatus.PAUSED, SkillExperimentStatus.TESTING].includes(
        experiment.status,
      )
    ) {
      throw new ConflictException(
        'There is no running experiment with a best version to apply.',
      );
    }
    const champion = experiment.championVariantId
      ? await this.variants.findOneBy({ id: experiment.championVariantId })
      : null;
    if (!champion) {
      throw new ConflictException('This experiment has no best version yet.');
    }
    if (champion.isOriginal) {
      throw new BadRequestException(
        'The original is still the best version, so there is nothing to apply.',
      );
    }

    const actorId = currentUserId();
    // Off first, so the engine cannot read the new skill text as an edit and
    // restart a run on top of the apply.
    const stopped = await this.state.guardedUpdate(experiment, LIVE, {
      status: SkillExperimentStatus.OFF,
      pausedReason: null,
      championVariantId: null,
      challengerVariantId: null,
      updatedBy: actorId,
    });
    if (!stopped) {
      throw new ConflictException(
        'The experiment changed state — refresh and try again.',
      );
    }
    try {
      await this.promptsService.updatePrompt(promptId, {
        prompt: champion.content,
        useDashboardOverride: true,
      });
    } catch (error) {
      // The experiment is already off, so the skill serves its own text; say
      // so rather than leave the admin guessing which text is live.
      await this.state.logEvent(
        experiment.id,
        SkillExperimentEventType.ERROR,
        `Applying ${champion.label} failed, so the skill kept its own text and auto-improve is off: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { variantId: champion.id, actorId },
      );
      this.router.invalidate();
      throw error;
    }
    await this.state.abandonPending(experiment.id);
    await this.state.retireLiveVariants(
      experiment,
      `Experiment ended: ${champion.label} was applied to the skill.`,
    );
    await this.variants.update(champion.id, {
      statusReason: `Applied to the skill as its new text.`,
    });
    await this.state.logEvent(
      experiment.id,
      SkillExperimentEventType.APPLIED,
      `${champion.label} (score ${champion.meanScore ?? '—'}) was applied to the skill as a new version. ` +
        'Auto-improve is off; turn it on again to keep improving from here.',
      { variantId: champion.id, actorId },
    );
    this.router.invalidate();
    return this.getDetail(promptId);
  }

  /** Judged samples for one variant (or all), lowest score first. */
  async listObservations(
    promptId: string,
    query: SkillExperimentObservationsQueryDto,
  ) {
    const experiment = await this.requireExperiment(promptId);
    const [items, count] = await this.observations.findAndCount({
      where: {
        experimentId: experiment.id,
        ...(query.variantId ? { variantId: query.variantId } : {}),
        status: In([
          SkillObservationStatus.JUDGED,
          SkillObservationStatus.FAILED,
        ]),
      },
      order: { judgedAt: 'DESC' },
      take: query.limit ?? 20,
      skip: query.offset ?? 0,
    });
    return { items, count };
  }

  async listEvents(promptId: string, limit = 50, offset = 0) {
    const experiment = await this.requireExperiment(promptId);
    const [items, count] = await this.events.findAndCount({
      where: { experimentId: experiment.id },
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 200),
      skip: offset,
    });
    return { items, count };
  }

  private async summarize(
    experiments: SkillExperiment[],
  ): Promise<Map<string, ExperimentSummary>> {
    const ids = experiments.flatMap((e) =>
      [e.championVariantId, e.challengerVariantId].filter(
        (id): id is string => !!id,
      ),
    );
    const variants = ids.length
      ? await this.variants.find({ where: { id: In(ids) } })
      : [];
    const originals = experiments.length
      ? await this.variants.find({
          where: {
            experimentId: In(experiments.map((e) => e.id)),
            isOriginal: true,
          },
        })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));
    const map = new Map<string, ExperimentSummary>();
    for (const e of experiments) {
      const champion = e.championVariantId
        ? byId.get(e.championVariantId)
        : null;
      const challenger = e.challengerVariantId
        ? byId.get(e.challengerVariantId)
        : null;
      const original = originals.find(
        (v) => v.experimentId === e.id && v.run === e.run,
      );
      map.set(e.id, {
        id: e.id,
        status: e.status,
        pausedReason: e.pausedReason ?? null,
        run: e.run,
        targetScore: e.targetScore,
        championLabel: champion?.label ?? null,
        championScore: champion?.meanScore ?? null,
        originalScore: original?.meanScore ?? null,
        championJudged: champion?.judgedCount ?? 0,
        challengerLabel: challenger?.label ?? null,
        variantsDrafted: e.variantsDrafted,
        lastTickAt: e.lastTickAt ?? null,
        updatedAt: e.updatedAt,
      });
    }
    return map;
  }

  /** Judge + designer spend for this experiment, from `llm_usage`. */
  private async spend(experimentId: string) {
    const rows: Array<{
      task: string;
      model: string;
      calls: number;
      prompt: number;
      completion: number;
    }> = await this.experiments.query(
      `SELECT task, model, COUNT(*)::int AS calls,
              COALESCE(SUM("promptTokens"), 0)::bigint AS prompt,
              COALESCE(SUM("completionTokens"), 0)::bigint AS completion
         FROM llm_usage
        WHERE task IN ($2, $3) AND metadata->>'experimentId' = $1
        GROUP BY task, model`,
      // `task` first: it is indexed, and narrows llm_usage to these two labels
      // before the jsonb filter runs.
      [
        experimentId,
        LlmTask.SKILL_EXPERIMENT_JUDGE,
        LlmTask.SKILL_EXPERIMENT_DESIGNER,
      ],
    );
    let costUsd = 0;
    let unpriced = false;
    let calls = 0;
    for (const row of rows) {
      const { costUsd: cost, priced } = computeCostUsd(
        row.model,
        Number(row.prompt),
        Number(row.completion),
      );
      costUsd += cost;
      unpriced ||= !priced;
      calls += Number(row.calls);
    }
    return {
      calls,
      costUsd: Math.round(costUsd * 100) / 100,
      unpriced,
    };
  }

  private async requirePrompt(promptId: string): Promise<Prompt> {
    const prompt = await this.prompts.findOneBy({ id: promptId });
    if (!prompt) throw new NotFoundException('Skill not found');
    return prompt;
  }

  private requireConnected(prompt: Prompt): void {
    if (!isConnectedSkill(prompt.promptCode)) {
      throw new BadRequestException(
        "This skill doesn't report its outputs yet, so it can't run an experiment.",
      );
    }
  }

  private async requireExperiment(promptId: string): Promise<SkillExperiment> {
    const experiment = await this.experiments.findOneBy({ promptId });
    if (!experiment) {
      throw new NotFoundException('This skill has no experiment yet.');
    }
    return experiment;
  }
}

function promptView(prompt: Prompt) {
  return {
    id: prompt.id,
    promptCode: prompt.promptCode,
    name: prompt.name,
    description: prompt.description,
  };
}

function currentUserId(): number | null {
  const id = Number(ExecutionManager.getUserId());
  return Number.isFinite(id) && id > 0 ? id : null;
}

function assertUniqueKeys(rubric: Array<{ key: string }>): void {
  const keys = rubric.map((c) => c.key);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('Each rubric criterion needs a unique key.');
  }
}
