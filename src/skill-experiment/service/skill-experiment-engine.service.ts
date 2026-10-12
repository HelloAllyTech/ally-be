import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { SkillExperiment } from '../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../entity/skill-experiment-variant.entity';
import { SkillExperimentObservation } from '../entity/skill-experiment-observation.entity';
import {
  SkillExperimentEventType,
  SkillExperimentPauseReason,
  SkillExperimentStatus,
  SkillObservationStatus,
  SkillVariantStatus,
} from '../enum/skill-experiment.enum';
import {
  CONNECTED_SKILLS,
  SKILL_EXPERIMENT_ENGINE,
} from '../constants/skill-experiment.constants';
import { compareArms, earlyStopReason } from '../util/experiment-stats.util';
import { conformsToShape, inferOutputShape } from '../util/output-shape.util';
import { contentHash } from '../util/placeholder-lock.util';
import { SkillExperimentJudgeService } from './skill-experiment-judge.service';
import {
  DesignerContext,
  SkillExperimentDesignerService,
} from './skill-experiment-designer.service';
import {
  EMPTY_STATS,
  SkillExperimentStateService,
  VariantStats,
} from './skill-experiment-state.service';
import { SkillExperimentRouterService } from './skill-experiment-router.service';

const ADVANCING = [
  SkillExperimentStatus.BASELINE,
  SkillExperimentStatus.TESTING,
];

/**
 * The auto-improve loop. One tick, per experiment:
 *
 *   1. If the skill text was edited since the run started, restart the run
 *      from the new text — the admin's edit always wins.
 *   2. Judge a bounded batch of waiting outputs. A failed call or an output
 *      that broke the established shape scores 0 without a judge call.
 *   3. Recompute each variant's stats from its judged outputs.
 *   4. Advance:
 *      BASELINE → once the original has enough judged outputs, learn its
 *        output shape; pause if it already meets the target, else draft.
 *      TESTING  → pull a challenger early if it is clearly worse or breaks the
 *        format; otherwise, once both arms have the minimum sample, crown it
 *        or retire it (see `compareArms`). Then pause on target reached,
 *        budget spent or no progress — or draft the next challenger.
 *
 * Runs in the background under its own advisory lock: a tick makes many LLM
 * calls, and the shared scheduler bucket runs its tasks one after another, so
 * awaiting it there would hold up every other 5-minute job.
 */
@Injectable()
export class SkillExperimentEngineService {
  private readonly logger = LoggerService.getInstance(
    SkillExperimentEngineService.name,
  );
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly state: SkillExperimentStateService,
    private readonly judge: SkillExperimentJudgeService,
    private readonly designer: SkillExperimentDesignerService,
    private readonly router: SkillExperimentRouterService,
    @InjectRepository(Prompt)
    private readonly prompts: Repository<Prompt>,
  ) {}

  /** Scheduler entry: start a tick in the background unless one is running here. */
  kick(): void {
    if (this.running) return;
    this.running = true;
    void this.tickUnderLock()
      .catch((error) =>
        this.logger.error(
          `[SKILL_EXPERIMENT] tick failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        this.running = false;
      });
  }

  private async tickUnderLock(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [
          SKILL_EXPERIMENT_ENGINE.LOCK_NAMESPACE,
          SKILL_EXPERIMENT_ENGINE.LOCK_KEY,
        ],
      );
      if (!rows?.[0]?.locked) return;
      try {
        await this.tick();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1, $2)', [
          SKILL_EXPERIMENT_ENGINE.LOCK_NAMESPACE,
          SKILL_EXPERIMENT_ENGINE.LOCK_KEY,
        ]);
      }
    } finally {
      await runner.release();
    }
  }

  /** One pass over every live experiment, within the tick's time budget. */
  async tick(now: () => number = Date.now): Promise<void> {
    const deadline = now() + SKILL_EXPERIMENT_ENGINE.TICK_BUDGET_MS;
    const live = await this.state.experiments.find({
      where: {
        status: In([...ADVANCING, SkillExperimentStatus.PAUSED]),
      },
      order: { updatedAt: 'ASC' },
    });
    for (const experiment of live) {
      if (now() > deadline) break;
      try {
        await this.process(experiment.id, () => now() > deadline);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[SKILL_EXPERIMENT] ${experiment.promptCode}: ${message}`,
        );
        await this.state.experiments.update(experiment.id, {
          lastError: message.slice(0, 2000),
        });
        await this.state.logEvent(
          experiment.id,
          SkillExperimentEventType.ERROR,
          `The loop hit an error and will retry on the next tick: ${message.slice(0, 300)}`,
        );
      }
    }
  }

  async process(experimentId: string, outOfTime: () => boolean): Promise<void> {
    const experiment = await this.state.experiments.findOneByOrFail({
      id: experimentId,
    });

    if (await this.resetIfSkillEdited(experiment)) return;

    const variants = await this.state.variants.find({
      where: { experimentId: experiment.id, run: experiment.run },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const original = variants.find((v) => v.isOriginal);
    if (!original) return;
    const prompt = await this.prompts.findOneBy({ id: experiment.promptId });

    await this.judgePending(experiment, original, prompt, outOfTime);
    const stats = await this.state.refreshStats(experiment);
    await this.state.experiments.update(experiment.id, {
      lastTickAt: new Date(),
      lastError: null,
    });

    if (!ADVANCING.includes(experiment.status) || outOfTime()) return;
    const champion = experiment.championVariantId
      ? byId.get(experiment.championVariantId)
      : undefined;
    if (!champion) return;
    const championStats = stats.get(champion.id) ?? EMPTY_STATS;

    if (experiment.status === SkillExperimentStatus.BASELINE) {
      await this.finishBaseline(
        experiment,
        champion,
        championStats,
        prompt,
        original,
      );
      return;
    }

    const challenger = experiment.challengerVariantId
      ? byId.get(experiment.challengerVariantId)
      : undefined;
    if (!challenger) {
      await this.draftAndLaunch(
        experiment,
        champion,
        championStats,
        prompt,
        original,
      );
      return;
    }
    await this.decide(
      experiment,
      champion,
      championStats,
      challenger,
      stats.get(challenger.id) ?? EMPTY_STATS,
      prompt,
      original,
    );
  }

  /** The admin's edit wins: a run comparing against stale text is meaningless. */
  private async resetIfSkillEdited(
    experiment: SkillExperiment,
  ): Promise<boolean> {
    const text = await this.state.currentSkillText(experiment.promptCode);
    if (!text || contentHash(text) === experiment.baseContentHash) return false;
    await this.state.beginRun(
      experiment,
      text,
      [...ADVANCING, SkillExperimentStatus.PAUSED],
      {
        type: SkillExperimentEventType.RESET,
        message:
          'The skill text was edited in System Skills, so the experiment restarted from the new text.',
      },
    );
    return true;
  }

  private async finishBaseline(
    experiment: SkillExperiment,
    champion: SkillExperimentVariant,
    championStats: VariantStats,
    prompt: Prompt | null,
    original: SkillExperimentVariant,
  ): Promise<void> {
    if (championStats.n < experiment.minSamplesPerVariant) return;

    const outputs = await this.state.observations.find({
      select: ['output'],
      where: {
        variantId: champion.id,
        status: SkillObservationStatus.JUDGED,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const outputShape = inferOutputShape(
      outputs.map((o) => o.output).filter((o): o is string => !!o),
    );
    const moved = await this.state.guardedUpdate(
      experiment,
      [SkillExperimentStatus.BASELINE],
      { status: SkillExperimentStatus.TESTING, outputShape },
    );
    if (!moved) return;
    experiment.status = SkillExperimentStatus.TESTING;
    experiment.outputShape = outputShape;

    await this.state.logEvent(
      experiment.id,
      SkillExperimentEventType.BASELINE_READY,
      `Baseline ready: the original scored ${championStats.mean.toFixed(1)} across ` +
        `${championStats.n} judged outputs (target ${experiment.targetScore}).`,
      {
        variantId: champion.id,
        metadata: {
          mean: championStats.mean,
          n: championStats.n,
          outputShape,
        },
      },
    );

    if (championStats.mean >= experiment.targetScore) {
      await this.state.pause(
        experiment,
        SkillExperimentPauseReason.BASELINE_MEETS_TARGET,
        { mean: championStats.mean },
      );
      return;
    }
    await this.draftAndLaunch(
      experiment,
      champion,
      championStats,
      prompt,
      original,
    );
  }

  private async decide(
    experiment: SkillExperiment,
    champion: SkillExperimentVariant,
    championStats: VariantStats,
    challenger: SkillExperimentVariant,
    challengerStats: VariantStats,
    prompt: Prompt | null,
    original: SkillExperimentVariant,
  ): Promise<void> {
    const early = earlyStopReason(
      championStats,
      challengerStats,
      experiment.minSamplesPerVariant,
    );
    const comparison = compareArms(championStats, challengerStats, {
      minSamples: experiment.minSamplesPerVariant,
      minImprovement: experiment.minImprovement,
    });

    if (!early && comparison.verdict === 'challenger_wins') {
      const promoted = await this.state.guardedUpdate(
        experiment,
        [SkillExperimentStatus.TESTING],
        {
          championVariantId: challenger.id,
          challengerVariantId: null,
          consecutiveLosses: 0,
        },
      );
      if (!promoted) return;
      await this.state.retireVariant(
        champion.id,
        `Replaced by ${challenger.label}, which scored ${challengerStats.mean.toFixed(1)} ` +
          `against ${championStats.mean.toFixed(1)}.`,
      );
      await this.state.variants.update(challenger.id, {
        status: SkillVariantStatus.CHAMPION,
        statusReason: null,
      });
      await this.state.logEvent(
        experiment.id,
        SkillExperimentEventType.CHAMPION_CHANGED,
        `${challenger.label} beat ${champion.label}: ${challengerStats.mean.toFixed(1)} ` +
          `vs ${championStats.mean.toFixed(1)} (+${comparison.diff.toFixed(1)} points). ` +
          `${challenger.label} is now the best version.`,
        {
          variantId: challenger.id,
          metadata: {
            diff: comparison.diff,
            z: finiteOrNull(comparison.z),
            champion: championStats,
            challenger: challengerStats,
          },
        },
      );
      this.router.invalidate();

      const next = {
        ...experiment,
        championVariantId: challenger.id,
        challengerVariantId: null,
        consecutiveLosses: 0,
      } as SkillExperiment;
      if (challengerStats.mean >= experiment.targetScore) {
        await this.state.pause(
          next,
          SkillExperimentPauseReason.TARGET_REACHED,
          {
            mean: challengerStats.mean,
          },
        );
        return;
      }
      await this.nextStep(
        next,
        {
          ...challenger,
          status: SkillVariantStatus.CHAMPION,
        } as SkillExperimentVariant,
        challengerStats,
        prompt,
        original,
      );
      return;
    }

    const lossReason =
      early ??
      (comparison.verdict === 'challenger_loses'
        ? `Did not beat ${champion.label}: ${challengerStats.mean.toFixed(1)} vs ` +
          `${championStats.mean.toFixed(1)} after ${challengerStats.n} outputs.`
        : null);
    if (!lossReason) return;

    const losses = experiment.consecutiveLosses + 1;
    const retired = await this.state.guardedUpdate(
      experiment,
      [SkillExperimentStatus.TESTING],
      { challengerVariantId: null, consecutiveLosses: losses },
    );
    if (!retired) return;
    await this.state.retireVariant(challenger.id, lossReason);
    await this.state.logEvent(
      experiment.id,
      SkillExperimentEventType.VARIANT_RETIRED,
      `${challenger.label} retired${early ? ' early' : ''}: ${lossReason}`,
      {
        variantId: challenger.id,
        metadata: {
          early: !!early,
          diff: comparison.diff,
          champion: championStats,
          challenger: challengerStats,
        },
      },
    );
    this.router.invalidate();
    await this.nextStep(
      {
        ...experiment,
        challengerVariantId: null,
        consecutiveLosses: losses,
      } as SkillExperiment,
      champion,
      championStats,
      prompt,
      original,
    );
  }

  private async nextStep(
    experiment: SkillExperiment,
    champion: SkillExperimentVariant,
    championStats: VariantStats,
    prompt: Prompt | null,
    original: SkillExperimentVariant,
  ): Promise<void> {
    if (experiment.consecutiveLosses >= experiment.maxConsecutiveLosses) {
      await this.state.pause(
        experiment,
        SkillExperimentPauseReason.NO_PROGRESS,
        {
          consecutiveLosses: experiment.consecutiveLosses,
        },
      );
      return;
    }
    if (experiment.variantsDrafted >= experiment.maxVariants) {
      await this.state.pause(
        experiment,
        SkillExperimentPauseReason.MAX_VARIANTS,
        {
          variantsDrafted: experiment.variantsDrafted,
        },
      );
      return;
    }
    await this.draftAndLaunch(
      experiment,
      champion,
      championStats,
      prompt,
      original,
    );
  }

  private async draftAndLaunch(
    experiment: SkillExperiment,
    champion: SkillExperimentVariant,
    championStats: VariantStats,
    prompt: Prompt | null,
    original: SkillExperimentVariant,
  ): Promise<void> {
    if (experiment.variantsDrafted >= experiment.maxVariants) {
      await this.state.pause(
        experiment,
        SkillExperimentPauseReason.MAX_VARIANTS,
        {
          variantsDrafted: experiment.variantsDrafted,
        },
      );
      return;
    }

    const context = await this.designerContext(
      experiment,
      champion,
      championStats,
      prompt,
      original,
    );
    const draft = await this.designer.draft(context);

    // The draft took a while; only act if nothing moved the experiment meanwhile.
    const current = await this.state.experiments.findOneBy({
      id: experiment.id,
    });
    if (
      !current ||
      current.run !== experiment.run ||
      current.status !== SkillExperimentStatus.TESTING ||
      current.challengerVariantId
    ) {
      return;
    }

    const ordinal = await this.nextOrdinal(experiment);
    const label = `V${ordinal}`;

    if (!draft.ok) {
      const failures = current.designFailures + 1;
      if (draft.lastContent) {
        await this.state.variants.save(
          this.state.variants.create({
            experimentId: experiment.id,
            run: experiment.run,
            ordinal,
            label,
            content: draft.lastContent,
            contentHash: contentHash(draft.lastContent),
            parentVariantId: champion.id,
            status: SkillVariantStatus.REJECTED,
            statusReason: draft.errors.join(' '),
            designerModel: draft.model,
          }),
        );
      }
      await this.state.experiments.update(experiment.id, {
        designFailures: failures,
      });
      await this.state.logEvent(
        experiment.id,
        SkillExperimentEventType.VARIANT_REJECTED,
        `The designer's draft was rejected and never served: ${draft.errors.join(' ')}`,
        {
          metadata: {
            errors: draft.errors,
            attempts: SKILL_EXPERIMENT_ENGINE.DESIGNER_MAX_ATTEMPTS,
          },
        },
      );
      if (failures >= SKILL_EXPERIMENT_ENGINE.MAX_DESIGN_FAILURES) {
        await this.state.pause(
          current,
          SkillExperimentPauseReason.DESIGNER_FAILED,
          {
            designFailures: failures,
          },
        );
      }
      return;
    }

    const variant = await this.state.variants.save(
      this.state.variants.create({
        experimentId: experiment.id,
        run: experiment.run,
        ordinal,
        label,
        content: draft.content,
        contentHash: contentHash(draft.content),
        parentVariantId: champion.id,
        status: SkillVariantStatus.CHALLENGER,
        changeSummary: draft.changeSummary || null,
        hypothesis: draft.hypothesis || null,
        designerModel: draft.model,
        launchedAt: new Date(),
      }),
    );
    const launched = await this.state.guardedUpdate(
      current,
      [SkillExperimentStatus.TESTING],
      {
        challengerVariantId: variant.id,
        variantsDrafted: current.variantsDrafted + 1,
        designFailures: 0,
      },
    );
    if (!launched) {
      await this.state.variants.update(variant.id, {
        status: SkillVariantStatus.RETIRED,
        statusReason:
          'The experiment changed state before this draft could launch.',
        retiredAt: new Date(),
        launchedAt: null,
      });
      return;
    }
    await this.state.logEvent(
      experiment.id,
      SkillExperimentEventType.VARIANT_LAUNCHED,
      `${label} is live for ${current.challengerTrafficPercent}% of traffic against ` +
        `${champion.label}. ${draft.changeSummary}`.trim(),
      { variantId: variant.id, metadata: { parent: champion.label } },
    );
    this.router.invalidate();
  }

  private async designerContext(
    experiment: SkillExperiment,
    champion: SkillExperimentVariant,
    championStats: VariantStats,
    prompt: Prompt | null,
    original: SkillExperimentVariant,
  ): Promise<DesignerContext> {
    const lowScoring = await this.state.observations.find({
      where: {
        variantId: champion.id,
        status: SkillObservationStatus.JUDGED,
      },
      order: { score: 'ASC', createdAt: 'DESC' },
      take: SKILL_EXPERIMENT_ENGINE.DESIGNER_EXAMPLES,
    });
    const tried = await this.state.variants.find({
      where: {
        experimentId: experiment.id,
        run: experiment.run,
        isOriginal: false,
        status: In([SkillVariantStatus.RETIRED, SkillVariantStatus.REJECTED]),
      },
      order: { ordinal: 'DESC' },
      take: SKILL_EXPERIMENT_ENGINE.DESIGNER_HISTORY,
    });

    return {
      experimentId: experiment.id,
      skill: skillDescriptor(experiment, prompt),
      rubric: experiment.rubric,
      targetScore: experiment.targetScore,
      originalText: original.content,
      currentBest: {
        label: champion.label,
        text: champion.content,
        meanScore: championStats.n ? round1(championStats.mean) : null,
        criterionMeans: champion.criterionMeans ?? null,
      },
      lowScoringExamples: lowScoring
        .filter((o) => o.score !== null && o.score !== undefined)
        .map((o) => ({
          score: Number(o.score),
          input: o.input,
          output: o.output ?? o.skillError ?? '',
          judgeReasons: o.criterionScores ?? {},
        })),
      triedBefore: tried.map((v) => ({
        label: v.label,
        changeSummary: v.changeSummary ?? null,
        hypothesis: v.hypothesis ?? null,
        meanScore: v.meanScore ?? null,
        outcome: v.statusReason ?? null,
      })),
      model: experiment.designerModel ?? null,
    };
  }

  private async judgePending(
    experiment: SkillExperiment,
    original: SkillExperimentVariant,
    prompt: Prompt | null,
    outOfTime: () => boolean,
  ): Promise<void> {
    const pending = await this.state.observations.find({
      where: {
        experimentId: experiment.id,
        status: SkillObservationStatus.PENDING,
      },
      order: { createdAt: 'ASC' },
      take: SKILL_EXPERIMENT_ENGINE.JUDGE_BATCH_PER_TICK,
    });
    const queue = [...pending];
    const worker = async () => {
      while (queue.length && !outOfTime()) {
        const observation = queue.shift()!;
        await this.judgeOne(experiment, original, prompt, observation);
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            SKILL_EXPERIMENT_ENGINE.JUDGE_CONCURRENCY,
            queue.length,
          ),
        },
        worker,
      ),
    );
  }

  /** Score one output. Deterministic zero for failures; the judge for the rest. */
  async judgeOne(
    experiment: SkillExperiment,
    original: SkillExperimentVariant,
    prompt: Prompt | null,
    observation: SkillExperimentObservation,
  ): Promise<void> {
    const failure = observation.skillError
      ? `The skill call failed: ${observation.skillError}`
      : !conformsToShape(observation.output, experiment.outputShape)
        ? experiment.outputShape?.kind === 'json'
          ? `The output was not a JSON object with ${experiment.outputShape.requiredKeys.join(', ')}.`
          : 'The output was empty.'
        : null;

    if (failure) {
      await this.state.observations.update(observation.id, {
        status: SkillObservationStatus.JUDGED,
        formatOk: false,
        score: 0,
        judgeSummary: failure.slice(0, 1000),
        judgedAt: new Date(),
      });
      return;
    }

    try {
      const verdict = await this.judge.judge({
        experimentId: experiment.id,
        observationId: observation.id,
        skill: skillDescriptor(experiment, prompt),
        rubric: experiment.rubric,
        taskInstructions: original.content,
        input: observation.input,
        output: observation.output ?? '',
        model: experiment.judgeModel ?? null,
      });
      await this.state.observations.update(observation.id, {
        status: SkillObservationStatus.JUDGED,
        formatOk: true,
        score: verdict.score,
        criterionScores: verdict.criteria,
        judgeSummary: verdict.summary || null,
        judgeModel: verdict.model,
        judgeError: null,
        judgeAttempts: observation.judgeAttempts + 1,
        judgedAt: new Date(),
      });
    } catch (error) {
      const attempts = observation.judgeAttempts + 1;
      await this.state.observations.update(observation.id, {
        judgeAttempts: attempts,
        judgeError: (error instanceof Error
          ? error.message
          : String(error)
        ).slice(0, 1000),
        ...(attempts >= SKILL_EXPERIMENT_ENGINE.JUDGE_MAX_ATTEMPTS
          ? { status: SkillObservationStatus.FAILED }
          : {}),
      });
    }
  }

  private async nextOrdinal(experiment: SkillExperiment): Promise<number> {
    const row: { max: number | null } | undefined = await this.state.variants
      .createQueryBuilder('v')
      .select('MAX(v.ordinal)', 'max')
      .where('v.experimentId = :id', { id: experiment.id })
      .andWhere('v.run = :run', { run: experiment.run })
      .getRawOne();
    return Number(row?.max ?? 0) + 1;
  }
}

function skillDescriptor(experiment: SkillExperiment, prompt: Prompt | null) {
  return {
    name: prompt?.name ?? experiment.promptCode,
    description: prompt?.description ?? '',
    outputDescription:
      CONNECTED_SKILLS[experiment.promptCode]?.outputDescription ?? '',
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}
