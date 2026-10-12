import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { SkillExperiment } from '../entity/skill-experiment.entity';
import { SkillExperimentVariant } from '../entity/skill-experiment-variant.entity';
import { SkillExperimentObservation } from '../entity/skill-experiment-observation.entity';
import {
  SkillExperimentStatus,
  SkillObservationStatus,
} from '../enum/skill-experiment.enum';
import {
  SKILL_EXPERIMENT_ENGINE,
  isConnectedSkill,
} from '../constants/skill-experiment.constants';
import { SkillArm, SkillOutputReport } from '../type/skill-experiment.type';

interface LiveVariant {
  id: string;
  content: string;
  isOriginal: boolean;
}

interface LiveExperiment {
  experimentId: string;
  status: SkillExperimentStatus;
  champion: LiveVariant;
  challenger: LiveVariant | null;
  challengerPercent: number;
  pending: number;
}

const LIVE_STATUSES = [
  SkillExperimentStatus.BASELINE,
  SkillExperimentStatus.TESTING,
  SkillExperimentStatus.PAUSED,
];

/**
 * The only part of auto-improve on a skill's request path: decides which text
 * one execution runs (`assign`) and records what it produced (`record`).
 *
 * Both are built to be invisible when anything goes wrong. `assign` returns
 * null — "run the skill exactly as you would without experiments" — on any
 * error, and `record` never rejects. An experiment may make a skill better or
 * worse by design; it must never make it fail.
 *
 * Live experiments are read as one snapshot, refreshed at most every 30 s per
 * process, so a skill call costs no database read. Admin actions and engine
 * transitions call `invalidate()`; other replicas catch up within the TTL.
 */
@Injectable()
export class SkillExperimentRouterService {
  private readonly logger = LoggerService.getInstance(
    SkillExperimentRouterService.name,
  );
  private snapshot: Map<string, LiveExperiment> | null = null;
  private snapshotAt = 0;
  private loading: Promise<Map<string, LiveExperiment>> | null = null;

  constructor(
    @InjectRepository(SkillExperiment)
    private readonly experiments: Repository<SkillExperiment>,
    @InjectRepository(SkillExperimentVariant)
    private readonly variants: Repository<SkillExperimentVariant>,
    @InjectRepository(SkillExperimentObservation)
    private readonly observations: Repository<SkillExperimentObservation>,
  ) {}

  /**
   * Which text this execution of `promptCode` should run, or null when no
   * experiment is live for it (the caller resolves the skill as usual).
   */
  async assign(promptCode: string): Promise<SkillArm | null> {
    if (!isConnectedSkill(promptCode)) return null;
    try {
      const live = (await this.liveExperiments()).get(promptCode);
      if (!live) return null;

      const useChallenger =
        live.status === SkillExperimentStatus.TESTING &&
        live.challenger !== null &&
        Math.random() * 100 < live.challengerPercent;
      const variant = useChallenger ? live.challenger! : live.champion;

      return {
        experimentId: live.experimentId,
        variantId: variant.id,
        promptCode,
        content: variant.content,
        isOriginal: variant.isOriginal,
        // Paused: the champion serves everyone, but the experiment is not
        // collecting. A backlog the judge has not caught up with also stops
        // collection, so a traffic spike cannot become an unbounded judge bill.
        record:
          live.status !== SkillExperimentStatus.PAUSED &&
          live.pending < SKILL_EXPERIMENT_ENGINE.MAX_PENDING_PER_EXPERIMENT,
      };
    } catch (error) {
      this.logger.warn(
        `[SKILL_EXPERIMENT] assign failed for ${promptCode}, serving the skill as usual: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Store one execution's input and output for the judge. Fire-and-forget:
   * callers `void` it, and it never rejects.
   */
  async record(
    arm: SkillArm | null | undefined,
    report: SkillOutputReport,
  ): Promise<void> {
    if (!arm?.record) return;
    try {
      await this.observations.insert({
        experimentId: arm.experimentId,
        variantId: arm.variantId,
        promptCode: arm.promptCode,
        tenantId: report.tenantId ?? null,
        input: truncateInput(report.input),
        output:
          report.output === undefined
            ? null
            : report.output.slice(0, SKILL_EXPERIMENT_ENGINE.MAX_OUTPUT_CHARS),
        skillError: report.error ? report.error.slice(0, 2000) : null,
        status: SkillObservationStatus.PENDING,
      });
      const live = this.snapshot?.get(arm.promptCode);
      if (live) live.pending += 1;
    } catch (error) {
      this.logger.warn(
        `[SKILL_EXPERIMENT] could not record an output for ${arm.promptCode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Drop the snapshot so the next `assign` re-reads. Same-process only. */
  invalidate(): void {
    this.snapshot = null;
    this.snapshotAt = 0;
  }

  private async liveExperiments(): Promise<Map<string, LiveExperiment>> {
    const fresh =
      this.snapshot &&
      Date.now() - this.snapshotAt <
        SKILL_EXPERIMENT_ENGINE.ROUTER_CACHE_TTL_MS;
    if (fresh) return this.snapshot!;
    // One load at a time: a burst of skill calls after expiry shares it.
    if (!this.loading) {
      this.loading = this.load()
        .then((map) => {
          this.snapshot = map;
          this.snapshotAt = Date.now();
          return map;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  private async load(): Promise<Map<string, LiveExperiment>> {
    const experiments = await this.experiments.find({
      where: { status: In(LIVE_STATUSES) },
    });
    const map = new Map<string, LiveExperiment>();
    if (!experiments.length) return map;

    const variantIds = experiments.flatMap((e) =>
      [e.championVariantId, e.challengerVariantId].filter(
        (id): id is string => !!id,
      ),
    );
    const variants = variantIds.length
      ? await this.variants.find({ where: { id: In(variantIds) } })
      : [];
    const byId = new Map(variants.map((v) => [v.id, v]));

    const pendingRows: Array<{ experimentId: string; count: string }> =
      await this.observations
        .createQueryBuilder('o')
        .select('o.experimentId', 'experimentId')
        .addSelect('COUNT(*)', 'count')
        .where('o.experimentId IN (:...ids)', {
          ids: experiments.map((e) => e.id),
        })
        .andWhere('o.status = :pending', {
          pending: SkillObservationStatus.PENDING,
        })
        .groupBy('o.experimentId')
        .getRawMany();
    const pending = new Map(
      pendingRows.map((r) => [r.experimentId, Number(r.count)]),
    );

    for (const experiment of experiments) {
      const champion = experiment.championVariantId
        ? byId.get(experiment.championVariantId)
        : undefined;
      // A live experiment with no champion is mid-transition; serve the skill as usual.
      if (!champion) continue;
      const challenger = experiment.challengerVariantId
        ? byId.get(experiment.challengerVariantId)
        : undefined;
      map.set(experiment.promptCode, {
        experimentId: experiment.id,
        status: experiment.status,
        champion: toLive(champion),
        challenger: challenger ? toLive(challenger) : null,
        challengerPercent: experiment.challengerTrafficPercent,
        pending: pending.get(experiment.id) ?? 0,
      });
    }
    return map;
  }
}

function toLive(variant: SkillExperimentVariant): LiveVariant {
  return {
    id: variant.id,
    content: variant.content,
    isOriginal: variant.isOriginal,
  };
}

/** Cap each string field so one huge transcript cannot bloat the table. */
function truncateInput(input: Record<string, unknown>): Record<string, any> {
  const limit = SKILL_EXPERIMENT_ENGINE.MAX_INPUT_FIELD_CHARS;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === 'string' && value.length > limit) {
      out[key] =
        `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}
