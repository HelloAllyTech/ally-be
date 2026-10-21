import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebriefFeedback } from '../../debrief-feedback/entity/debrief-feedback.entity';
import { SkillExperiment } from '../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../entity/skill-experiment-variant.entity';
import {
  CONNECTED_SKILLS,
  SKILL_EXPERIMENT_AI_TASK_IDS,
  SKILL_EXPERIMENT_PROMPT_CODES,
  SKILL_EXPERIMENT_ENGINE,
} from '../constants/skill-experiment.constants';
import {
  SkillExperimentStatus,
  SkillVariantStatus,
  SkillExperimentEventType,
} from '../enum/skill-experiment.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SkillExperimentStateService } from './skill-experiment-state.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  parseFirstJsonObject,
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import { SkillExperimentObservation } from '../entity/skill-experiment-observation.entity';
import { contentHash } from '../util/placeholder-lock.util';
import { validateDraft } from './skill-experiment-designer.service';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class SkillExperimentChallengerJobService {
  private readonly logger = LoggerService.getInstance(
    SkillExperimentChallengerJobService.name,
  );

  constructor(
    @InjectRepository(DebriefFeedback)
    private readonly feedbackRepo: Repository<DebriefFeedback>,
    @InjectRepository(SkillExperiment)
    private readonly experimentRepo: Repository<SkillExperiment>,
    @InjectRepository(SkillExperimentVariant)
    private readonly variantRepo: Repository<SkillExperimentVariant>,
    private readonly llm: LlmCompletionService,
    private readonly promptSharedService: PromptSharedService,
    private readonly state: SkillExperimentStateService,
  ) {}

  async run(): Promise<void> {
    this.logger.info('Starting weekly debrief feedback analysis job');

    // Find experiments for debrief skills that are in TESTING status
    const debriefSkillCodes = Object.keys(CONNECTED_SKILLS).filter(
      (code) =>
        code.includes('scenario_evaluation') &&
        CONNECTED_SKILLS[code].runtime === 'ally-ai',
    );

    const experiments = await this.experimentRepo.find({
      where: {
        status: SkillExperimentStatus.TESTING,
      },
    });

    for (const experiment of experiments) {
      if (!debriefSkillCodes.includes(experiment.promptCode)) continue;
      await this.processExperiment(experiment);
    }
  }

  private async processExperiment(experiment: SkillExperiment): Promise<void> {
    // 1. Fetch recent feedback (last 7 days) for the champion variant
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const feedbacks = await this.feedbackRepo
      .createQueryBuilder('f')
      .innerJoin(
        SkillExperimentObservation,
        'o',
        "f.scenarioSessionId = (o.context->>'scenarioSessionId')::uuid",
      )
      .where('o.experimentId = :experimentId', { experimentId: experiment.id })
      .andWhere('o.variantId = :variantId', {
        variantId: experiment.championVariantId,
      })
      .andWhere('f.createdAt > :oneWeekAgo', { oneWeekAgo })
      .orderBy('f.createdAt', 'DESC')
      .take(100)
      .getMany();

    if (feedbacks.length === 0) {
      this.logger.info(`No recent feedback for experiment ${experiment.id}`);
      return;
    }

    // 2. Aggregate feedback
    const positiveCount = feedbacks.filter(
      (f) => f.rating === 'positive',
    ).length;
    const negativeCount = feedbacks.filter(
      (f) => f.rating === 'negative',
    ).length;
    const comments = feedbacks
      .map((f) => f.comment)
      .filter((c): c is string => !!c);

    const aggregatedFeedback = `
Positive Ratings: ${positiveCount}
Negative Ratings: ${negativeCount}
Comments:
${comments.map((c) => `- ${c}`).join('\n')}
    `.trim();

    // 3. Get champion prompt and original text
    const champion = await this.variantRepo.findOneBy({
      id: experiment.championVariantId!,
    });
    const original = await this.variantRepo.findOne({
      where: { experimentId: experiment.id, isOriginal: true },
    });

    if (!champion || !original) return;

    // 4. Generate new challenger
    const system = await this.promptSharedService.getPromptByCode(
      SKILL_EXPERIMENT_PROMPT_CODES.CHALLENGER_GENERATOR,
    );
    if (!system) {
      throw new NotFoundException(
        `Prompt not found: ${SKILL_EXPERIMENT_PROMPT_CODES.CHALLENGER_GENERATOR}`,
      );
    }

    const result = await this.llm.complete({
      taskId: SKILL_EXPERIMENT_AI_TASK_IDS.CHALLENGER_GENERATOR,
      task: LlmTask.SKILL_EXPERIMENT_CHALLENGER_JOB,
      promptCode: SKILL_EXPERIMENT_PROMPT_CODES.CHALLENGER_GENERATOR,
      system: renderTemplate(system, {
        championPrompt: champion.content,
        feedback: aggregatedFeedback,
        rubric: JSON.stringify(experiment.rubric, null, 2),
      }),
      prompt:
        'Generate the revised prompt based on the provided feedback and rubric.',
      jsonMode: true,
      maxTokens: SKILL_EXPERIMENT_ENGINE.DESIGNER_MAX_TOKENS,
      usageMetadata: {
        feature: 'skill-experiment',
        label: 'challenger-generator',
        experimentId: experiment.id,
      },
    });

    const parsed = parseFirstJsonObject(stripMarkdownFences(result.text));
    const revisedPrompt =
      typeof parsed?.revisedPrompt === 'string'
        ? stripMarkdownFences(parsed.revisedPrompt).trim()
        : '';

    if (!revisedPrompt) {
      this.logger.warn(
        `Failed to generate revised prompt for experiment ${experiment.id}`,
      );
      return;
    }

    // 5. Validate and save as new challenger
    const errors = validateDraft(
      {
        originalText: original.content,
        currentBest: {
          text: champion.content,
          label: champion.label,
          meanScore: champion.meanScore ?? null,
          criterionMeans: champion.criterionMeans ?? null,
        },
      },
      revisedPrompt,
    );

    if (errors.length > 0) {
      this.logger.warn(
        `Generated prompt for experiment ${experiment.id} failed validation: ${errors.join(', ')}`,
      );
      return;
    }

    // Retire current challenger if exists
    if (experiment.challengerVariantId) {
      await this.state.retireVariant(
        experiment.challengerVariantId,
        'Replaced by a new challenger generated from user feedback.',
      );
    }

    const ordinal = await this.nextOrdinal(experiment);
    const label = `V${ordinal}-FB`; // Mark it as feedback-based

    const variant = await this.variantRepo.save(
      this.variantRepo.create({
        experimentId: experiment.id,
        run: experiment.run,
        ordinal,
        label,
        content: revisedPrompt,
        contentHash: contentHash(revisedPrompt),
        parentVariantId: champion.id,
        status: SkillVariantStatus.CHALLENGER,
        changeSummary: (parsed?.changeSummary || '').slice(0, 1000),
        hypothesis: (parsed?.hypothesis || '').slice(0, 1000),
        designerModel: result.model,
        launchedAt: new Date(),
      }),
    );

    await this.experimentRepo.update(experiment.id, {
      challengerVariantId: variant.id,
      variantsDrafted: experiment.variantsDrafted + 1,
    });

    await this.state.logEvent(
      experiment.id,
      SkillExperimentEventType.VARIANT_LAUNCHED,
      `${label} (from feedback) is live for ${experiment.challengerTrafficPercent}% of traffic.`,
      { variantId: variant.id, metadata: { parent: champion.label } },
    );
  }

  private async nextOrdinal(experiment: SkillExperiment): Promise<number> {
    const row: { max: number | null } | undefined = await this.variantRepo
      .createQueryBuilder('v')
      .select('MAX(v.ordinal)', 'max')
      .where('v.experimentId = :id', { id: experiment.id })
      .andWhere('v.run = :run', { run: experiment.run })
      .getRawOne();
    return Number(row?.max ?? 0) + 1;
  }
}
