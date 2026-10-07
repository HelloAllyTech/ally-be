import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SkillExperiment } from '../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../entity/skill-experiment-variant.entity';
import { SkillExperimentObservation } from '../entity/skill-experiment-observation.entity';
import { SkillExperimentEvent } from '../entity/skill-experiment-event.entity';
import {
  SkillExperimentEventType,
  SkillExperimentPauseReason,
  SkillExperimentStatus,
  SkillObservationStatus,
  SkillVariantStatus,
} from '../enum/skill-experiment.enum';
import { contentHash } from '../util/placeholder-lock.util';
import { ArmStats } from '../util/experiment-stats.util';
import { SkillExperimentRouterService } from './skill-experiment-router.service';

export type VariantStats = ArmStats & { formatFailures: number };

const PAUSE_MESSAGES: Record<SkillExperimentPauseReason, string> = {
  [SkillExperimentPauseReason.TARGET_REACHED]:
    'Paused: the best version reached the target score. It now serves all traffic.',
  [SkillExperimentPauseReason.BASELINE_MEETS_TARGET]:
    'Paused: the original already meets the target score, so there is nothing to improve.',
  [SkillExperimentPauseReason.MAX_VARIANTS]:
    'Paused: this run has used its variant budget. The best version serves all traffic.',
  [SkillExperimentPauseReason.NO_PROGRESS]:
    'Paused: several challengers in a row failed to beat the best version. It serves all traffic.',
  [SkillExperimentPauseReason.DESIGNER_FAILED]:
    'Paused: the designer could not produce a draft that kept the runtime placeholders intact.',
};

/**
 * The state transitions both the engine and the admin act through, so the
 * loop and a person can never move an experiment by two different rules.
 *
 * Every transition is a guarded UPDATE (`WHERE status IN … AND run = …`): the
 * engine spends minutes on LLM calls between reading an experiment and writing
 * its next state, and an admin may stop it in between. A write that finds the
 * row moved on does nothing, and the caller discards its result.
 */
@Injectable()
export class SkillExperimentStateService {
  constructor(
    @InjectRepository(SkillExperiment)
    readonly experiments: Repository<SkillExperiment>,
    @InjectRepository(SkillExperimentVariant)
    readonly variants: Repository<SkillExperimentVariant>,
    @InjectRepository(SkillExperimentObservation)
    readonly observations: Repository<SkillExperimentObservation>,
    @InjectRepository(SkillExperimentEvent)
    readonly events: Repository<SkillExperimentEvent>,
    private readonly promptSharedService: PromptSharedService,
    private readonly router: SkillExperimentRouterService,
  ) {}

  /** The skill text as it runs today when no experiment is involved. */
  async currentSkillText(promptCode: string): Promise<string | null> {
    const text = await this.promptSharedService.getPromptByCode(promptCode);
    return text?.trim() ? text.trim() : null;
  }

  async logEvent(
    experimentId: string,
    type: SkillExperimentEventType,
    message: string,
    extra: {
      variantId?: string | null;
      metadata?: Record<string, any>;
      actorId?: number | null;
    } = {},
  ): Promise<void> {
    await this.events.insert({
      experimentId,
      type,
      message,
      variantId: extra.variantId ?? null,
      metadata: extra.metadata ?? null,
      actorId: extra.actorId ?? null,
    });
  }

  /**
   * Apply `patch` only if the experiment is still in one of `from` and on
   * `run`. Returns whether it applied.
   */
  async guardedUpdate(
    experiment: Pick<SkillExperiment, 'id' | 'run'>,
    from: SkillExperimentStatus[],
    patch: Partial<SkillExperiment>,
  ): Promise<boolean> {
    const result = await this.experiments
      .createQueryBuilder()
      .update(SkillExperiment)
      .set(patch as Record<string, unknown>)
      .where('id = :id', { id: experiment.id })
      .andWhere('status IN (:...from)', { from })
      .andWhere('run = :run', { run: experiment.run })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /**
   * Start a fresh run from `text`: retire whatever was live, snapshot `text` as
   * the new original champion, and collect a baseline. Used by start and by the
   * engine's reset when the skill was edited underneath a run.
   */
  async beginRun(
    experiment: SkillExperiment,
    text: string,
    from: SkillExperimentStatus[],
    event: {
      type: SkillExperimentEventType;
      message: string;
      actorId?: number | null;
    },
  ): Promise<boolean> {
    const nextRun = experiment.run + 1;
    const claimed = await this.guardedUpdate(experiment, from, {
      run: nextRun,
      status: SkillExperimentStatus.BASELINE,
      pausedReason: null,
      pausedAt: null,
      championVariantId: null,
      challengerVariantId: null,
      outputShape: null,
      baseContentHash: contentHash(text),
      variantsDrafted: 0,
      consecutiveLosses: 0,
      designFailures: 0,
      startedAt: new Date(),
      lastError: null,
      ...(event.actorId !== undefined ? { updatedBy: event.actorId } : {}),
    });
    if (!claimed) return false;

    await this.abandonPending(experiment.id);
    await this.retireLiveVariants(
      experiment,
      event.type === SkillExperimentEventType.RESET
        ? 'The skill text was edited, so the experiment restarted from the new text.'
        : 'A new run started.',
    );

    const original = await this.variants.save(
      this.variants.create({
        experimentId: experiment.id,
        run: nextRun,
        ordinal: 0,
        label: 'Original',
        isOriginal: true,
        content: text,
        contentHash: contentHash(text),
        status: SkillVariantStatus.CHAMPION,
        launchedAt: new Date(),
      }),
    );
    await this.experiments.update(experiment.id, {
      championVariantId: original.id,
    });
    await this.logEvent(experiment.id, event.type, event.message, {
      variantId: original.id,
      actorId: event.actorId ?? null,
      metadata: { run: nextRun },
    });
    this.router.invalidate();
    return true;
  }

  async pause(
    experiment: SkillExperiment,
    reason: SkillExperimentPauseReason,
    metadata: Record<string, unknown> = {},
  ): Promise<boolean> {
    const applied = await this.guardedUpdate(
      experiment,
      [SkillExperimentStatus.BASELINE, SkillExperimentStatus.TESTING],
      {
        status: SkillExperimentStatus.PAUSED,
        pausedReason: reason,
        pausedAt: new Date(),
        challengerVariantId: null,
      },
    );
    if (!applied) return false;
    if (experiment.challengerVariantId) {
      await this.retireVariant(
        experiment.challengerVariantId,
        'The experiment paused before this challenger finished.',
      );
    }
    await this.logEvent(
      experiment.id,
      SkillExperimentEventType.PAUSED,
      PAUSE_MESSAGES[reason],
      {
        variantId: experiment.championVariantId,
        metadata: { reason, ...metadata },
      },
    );
    this.router.invalidate();
    return true;
  }

  async retireVariant(variantId: string, reason: string): Promise<void> {
    await this.variants.update(variantId, {
      status: SkillVariantStatus.RETIRED,
      statusReason: reason,
      retiredAt: new Date(),
    });
  }

  /**
   * Close out outputs a run never got to judge. Without this they stay
   * `pending` forever — never scored, and counted against the next run's
   * backlog cap. Called whenever a run ends (stop, apply, reset, new run).
   */
  async abandonPending(experimentId: string): Promise<void> {
    await this.observations.update(
      { experimentId, status: SkillObservationStatus.PENDING },
      {
        status: SkillObservationStatus.FAILED,
        judgeError: 'The run ended before this output was judged.',
      },
    );
  }

  /** Retire the run's champion and challenger (stop, reset, new run). */
  async retireLiveVariants(
    experiment: Pick<SkillExperiment, 'id'>,
    reason: string,
  ): Promise<void> {
    await this.variants.update(
      {
        experimentId: experiment.id,
        status: In([
          SkillVariantStatus.CHAMPION,
          SkillVariantStatus.CHALLENGER,
        ]),
      },
      {
        status: SkillVariantStatus.RETIRED,
        statusReason: reason,
        retiredAt: new Date(),
      },
    );
  }

  /**
   * Recompute every variant's stats for the current run from its judged
   * observations, write the snapshot onto the variant rows, and return it.
   */
  async refreshStats(
    experiment: Pick<SkillExperiment, 'id' | 'run'>,
  ): Promise<Map<string, VariantStats>> {
    const rows: Array<{
      variantId: string;
      n: number;
      mean: number | null;
      sd: number | null;
      formatFailures: number;
    }> = await this.observations.query(
      `SELECT o."variantId" AS "variantId",
              COUNT(*)::int AS n,
              AVG(o.score)::float AS mean,
              COALESCE(STDDEV_SAMP(o.score), 0)::float AS sd,
              COUNT(*) FILTER (WHERE o."formatOk" = false)::int AS "formatFailures"
         FROM skill_experiment_observations o
         JOIN skill_experiment_variants v ON v.id = o."variantId"
        WHERE o."experimentId" = $1 AND v.run = $2 AND o.status = $3
        GROUP BY o."variantId"`,
      [experiment.id, experiment.run, SkillObservationStatus.JUDGED],
    );
    const criterionRows: Array<{
      variantId: string;
      key: string;
      mean: number;
    }> = await this.observations.query(
      `SELECT o."variantId" AS "variantId", c.key AS key,
                AVG((c.value->>'score')::numeric)::float AS mean
           FROM skill_experiment_observations o
           JOIN skill_experiment_variants v ON v.id = o."variantId"
           CROSS JOIN LATERAL jsonb_each(o."criterionScores") c
          WHERE o."experimentId" = $1 AND v.run = $2 AND o.status = $3
            AND o."criterionScores" IS NOT NULL
          GROUP BY o."variantId", c.key`,
      [experiment.id, experiment.run, SkillObservationStatus.JUDGED],
    );

    const criterionMeans = new Map<string, Record<string, number>>();
    for (const row of criterionRows) {
      const means = criterionMeans.get(row.variantId) ?? {};
      means[row.key] = Math.round(Number(row.mean) * 100) / 100;
      criterionMeans.set(row.variantId, means);
    }

    const stats = new Map<string, VariantStats>();
    for (const row of rows) {
      const entry: VariantStats = {
        n: Number(row.n),
        mean: Number(row.mean ?? 0),
        sd: Number(row.sd ?? 0),
        formatFailures: Number(row.formatFailures ?? 0),
      };
      stats.set(row.variantId, entry);
      await this.variants.update(row.variantId, {
        judgedCount: entry.n,
        meanScore: Math.round(entry.mean * 100) / 100,
        scoreStdDev: Math.round(entry.sd * 1000) / 1000,
        criterionMeans: criterionMeans.get(row.variantId) ?? null,
        formatFailures: entry.formatFailures,
      });
    }
    return stats;
  }
}

export const EMPTY_STATS: VariantStats = {
  n: 0,
  mean: 0,
  sd: 0,
  formatFailures: 0,
};
