import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';

import {
  ConsolidationBatchResult,
  ProductUpdateConsolidationService,
} from './product-update-consolidation.service';
import { ProductUpdateSourceRepository } from '../repository/product-update-source.repository';
import { ProductUpdateIngestService } from './product-update-ingest.service';
import {
  LivenessResult,
  ProductUpdateLivenessService,
} from './product-update-liveness.service';

const LOCK_KEY = 'product-updates:pipeline';
export const LAST_RUN_KEY = 'product-updates:last-run';

/**
 * Merges younger than this wait for the next run. `/ship` merges a backend PR
 * and its frontend PR minutes apart; giving both time to land means they are
 * grouped on hard evidence in one batch rather than stitched together later.
 */
const SETTLE_MS = 45 * 60 * 1000;

const SCHEDULED = { enrichLimit: 80, maxBatches: 3, lockSeconds: 50 * 60 };
/** A backfill replays the whole journal: every entry enriched, batches until nothing waits. */
const BACKFILL = {
  enrichLimit: 5000,
  maxBatches: 80,
  lockSeconds: 4 * 60 * 60,
};
/**
 * A scheduled pass that finds more waiting than this runs with backfill
 * limits. The first pass after the feature is switched on finds the whole
 * journal (~1,500 merges) waiting; at scheduled limits that is nine hours of
 * half-hourly passes, so it catches up in one go instead — nobody has to
 * remember to press a backfill button.
 */
const BACKLOG_FOR_BACKFILL = 150;

export interface PipelineRunResult {
  trigger: 'scheduled' | 'manual' | 'backfill';
  startedAt: string;
  finishedAt: string;
  ingested: number;
  enriched: number;
  degraded: number;
  batches: ConsolidationBatchResult[];
  liveness: LivenessResult | null;
  error: string | null;
}

/**
 * One pass of the whole pipeline: journal → sources → GitHub details →
 * consolidation → liveness (which also publishes).
 *
 * The same pass serves the half-hourly schedule, an admin's "run now" and a
 * backfill; a backfill is only a pass with bigger limits, a replay of the
 * journal through the code that handles today's merges (Stacks: *Replay
 * Capability for Stream Reprocessing*). A Redis lock makes passes exclusive
 * across replicas and across triggers.
 */
@Injectable()
export class ProductUpdatePipelineService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdatePipelineService.name,
  );

  constructor(
    private readonly sources: ProductUpdateSourceRepository,
    private readonly ingest: ProductUpdateIngestService,
    private readonly consolidation: ProductUpdateConsolidationService,
    private readonly liveness: ProductUpdateLivenessService,
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
  ) {}

  get enabled(): boolean {
    return this.configService.productUpdates.enabled;
  }

  /**
   * Merges read but not yet placed. Before anything has ever been placed the
   * whole journal is about to arrive, so a first pass counts as a backlog.
   */
  private async backlog(): Promise<number> {
    const counts = await this.sources.countByStatus();
    const placed = counts.consolidated + counts.noise;
    if (placed === 0) return Number.MAX_SAFE_INTEGER;
    return counts.pending + counts.enriched;
  }

  /**
   * Runs a pass, or returns null without running when one is already in
   * progress (or, for the schedule, when the feature is switched off).
   */
  async run(
    trigger: PipelineRunResult['trigger'],
  ): Promise<PipelineRunResult | null> {
    if (trigger === 'scheduled' && !this.enabled) return null;
    const limits =
      trigger === 'backfill' || (await this.backlog()) > BACKLOG_FOR_BACKFILL
        ? BACKFILL
        : SCHEDULED;
    if (!(await this.redisService.acquireLock(LOCK_KEY, limits.lockSeconds))) {
      return null;
    }

    const result: PipelineRunResult = {
      trigger,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      ingested: 0,
      enriched: 0,
      degraded: 0,
      batches: [],
      liveness: null,
      error: null,
    };

    try {
      result.ingested = (await this.ingest.ingestJournal()).added;
      const enrich = await this.ingest.enrichPending(limits.enrichLimit);
      result.enriched = enrich.enriched;
      result.degraded = enrich.degraded;

      for (let batch = 0; batch < limits.maxBatches; batch += 1) {
        const outcome = await this.consolidation.consolidateBatch({
          now: new Date(),
          settleMs: SETTLE_MS,
        });
        if (outcome.done) break;
        result.batches.push(outcome);
        if (outcome.error) break;
      }

      result.liveness = await this.liveness.refresh(new Date());
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[PRODUCT-UPDATES] Pipeline pass failed: ${result.error}`,
      );
    } finally {
      result.finishedAt = new Date().toISOString();
      await this.redisService.set(LAST_RUN_KEY, JSON.stringify(result));
      await this.redisService.releaseLock(LOCK_KEY);
    }
    return result;
  }

  /** True while a pass holds the lock, on any replica. */
  async isRunning(): Promise<boolean> {
    return Boolean(await this.redisService.get(LOCK_KEY));
  }

  async lastRun(): Promise<PipelineRunResult | null> {
    const raw = await this.redisService.get(LAST_RUN_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PipelineRunResult;
    } catch {
      return null;
    }
  }
}
