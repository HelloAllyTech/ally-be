import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';

import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapEmbeddingStatus } from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import { ReindexResponseDto } from '../dto/roadmap-response.dto';

/** Items per bulk-upsert call. 505 opportunities ÷ 64 ≈ 8 requests. */
const BULK_BATCH_SIZE = 64;
const MAX_EMBEDDING_ATTEMPTS = 5;

@Injectable()
export class RoadmapVectorService {
  private readonly logger = LoggerService.getInstance(
    RoadmapVectorService.name,
  );

  constructor(
    private readonly aiService: AiService,
    private readonly opportunityRepository: RoadmapOpportunityRepository,
  ) {}

  /** The text actually embedded. Kept in one place so the hash and the payload can't diverge. */
  private embedText(opportunity: RoadmapOpportunity): string {
    return opportunity.description;
  }

  static hashText(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  /**
   * Index one opportunity, BEST-EFFORT: this must never fail the caller's request.
   *
   * The standalone app had the same contract — lib/voyage.js returned null on any failure and
   * an opportunity inserted fine with `embedding = null`. In fact 431 of its 505 production
   * rows had no vector at all, so duplicate-detection was mostly non-functional. Degrading
   * quietly is therefore the *documented* behaviour, not a shortcut — but unlike the source we
   * record WHY, so the reconciliation sweep can heal it.
   */
  async indexQuietly(opportunityId: string): Promise<void> {
    try {
      const opportunity = await this.opportunityRepository.findOne({
        where: { id: opportunityId },
      });
      if (!opportunity) return;

      const text = this.embedText(opportunity);
      const response = await this.aiService.upsertRoadmapOpportunity({
        opportunity_id: opportunity.id,
        description: text,
        product_goal: opportunity.productGoal,
      });

      await this.opportunityRepository.update(opportunity.id, {
        embeddingStatus: RoadmapEmbeddingStatus.SUCCESS,
        embeddedAt: new Date(),
        embeddingAttempts: 0,
        textHash: response?.text_hash ?? RoadmapVectorService.hashText(text),
      });
    } catch (error) {
      await this.markFailed(opportunityId, error);
    }
  }

  /**
   * Remove one opportunity from the index. MANDATORY on soft delete and on merge.
   *
   * Postgres reads filter on `deletedAt IS NULL`; Weaviate has no idea. Skip this and
   * duplicate-detection keeps proposing a deleted opportunity forever. Best-effort like the
   * write path, which is exactly why the duplicates pipeline ALSO re-validates every candidate
   * against live Postgres rows, and why reindexAll() exists as the repair tool.
   */
  async removeQuietly(opportunityId: string): Promise<void> {
    try {
      await this.aiService.deleteRoadmapOpportunity(opportunityId);
      await this.opportunityRepository.update(opportunityId, {
        embeddingStatus: RoadmapEmbeddingStatus.SKIPPED,
        textHash: null,
      });
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Vector delete failed for ${opportunityId}; it may still surface as a ` +
          `duplicate candidate until the next reindex. ${(error as Error)?.message}`,
      );
      // Leave it PENDING so the sweep retries; a failed delete is drift that must be healed.
      await this.opportunityRepository.update(opportunityId, {
        embeddingStatus: RoadmapEmbeddingStatus.PENDING,
      });
    }
  }

  /**
   * Re-index everything that needs it, in batches.
   *
   * FAILS LOUDLY, by design. The standalone app's own backfill script
   * (scripts/classify-backfill.mjs) never checked whether its LLM call succeeded and wrote a
   * file labelled "Done. 241 classified." after 241 consecutive failures — which is how ~54% of
   * its production goal data became fiction. So: per-item failures are counted, logged, and
   * returned to the caller, and a batch that fails wholesale is logged at error level.
   *
   * Deliberately NOT a TypeORM migration. `migrationsRun: true` fires migrations at boot on
   * every environment and every replica, so network I/O inside one would run in CI, run on dev
   * laptops with no API key, run N times concurrently on N replicas, and block application
   * startup on a partial failure.
   */
  async reindexAll(force = false): Promise<ReindexResponseDto> {
    let queued = 0;
    let succeeded = 0;
    let failed = 0;

    for (;;) {
      const batch = force
        ? await this.opportunityRepository.find({
            where: {},
            order: { createdAt: 'ASC' },
            take: BULK_BATCH_SIZE,
            skip: queued,
          })
        : await this.opportunityRepository.findNeedingEmbedding(
            BULK_BATCH_SIZE,
            MAX_EMBEDDING_ATTEMPTS,
          );

      if (batch.length === 0) break;
      queued += batch.length;

      try {
        const response = await this.aiService.bulkUpsertRoadmapOpportunities({
          items: batch.map((o) => ({
            opportunity_id: o.id,
            description: this.embedText(o),
            product_goal: o.productGoal,
          })),
        });

        for (const ok of response?.succeeded ?? []) {
          succeeded += 1;
          await this.opportunityRepository.update(ok.opportunity_id, {
            embeddingStatus: RoadmapEmbeddingStatus.SUCCESS,
            embeddedAt: new Date(),
            embeddingAttempts: 0,
            textHash: ok.text_hash,
          });
        }

        for (const bad of response?.failed ?? []) {
          failed += 1;
          this.logger.error(
            `[ROADMAP] Reindex failed for ${bad.opportunity_id}: ${bad.error}`,
          );
          await this.markFailed(bad.opportunity_id, new Error(bad.error));
        }
      } catch (error) {
        // Whole-batch failure (ally-ai down, timeout). Count every item and keep going so one
        // bad batch doesn't abort a 505-row reindex.
        failed += batch.length;
        this.logger.error(
          `[ROADMAP] Reindex batch of ${batch.length} failed wholesale: ${(error as Error)?.message}`,
        );
        for (const o of batch) await this.markFailed(o.id, error);
      }

      // Not a rate-limit concern at this volume, but ally-ai embeds synchronously and this
      // keeps a reindex from monopolising it while people are using the board.
      await new Promise((resolve) => setTimeout(resolve, 250));

      if (force && batch.length < BULK_BATCH_SIZE) break;
    }

    this.logger.info(
      `[ROADMAP] Reindex complete: queued=${queued} succeeded=${succeeded} failed=${failed}`,
    );
    return { queued, succeeded, failed };
  }

  private async markFailed(
    opportunityId: string,
    error: unknown,
  ): Promise<void> {
    this.logger.warn(
      `[ROADMAP] Vector upsert failed for ${opportunityId}; the row is committed and will be ` +
        `retried by the reindex sweep. ${(error as Error)?.message}`,
    );
    try {
      await this.opportunityRepository.increment(
        { id: opportunityId },
        'embeddingAttempts',
        1,
      );
      await this.opportunityRepository.update(opportunityId, {
        embeddingStatus: RoadmapEmbeddingStatus.FAILED,
      });
    } catch {
      // Bookkeeping must never itself throw into the caller's request path.
    }
  }
}
