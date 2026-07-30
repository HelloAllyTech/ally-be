import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AiService } from 'src/ai/service/ai.service';
import { LoggerService } from 'src/logger/logger.service';

import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapEmbeddingStatus } from '../enum/roadmap-opportunity.enum';
import { RoadmapOpportunityRepository } from '../repository/roadmap-opportunity.repository';
import {
  PruneVectorsResponseDto,
  ReindexResponseDto,
} from '../dto/roadmap-response.dto';

/** Items per bulk-upsert call. 505 opportunities ÷ 64 ≈ 8 requests. */
const BULK_BATCH_SIZE = 64;
const MAX_EMBEDDING_ATTEMPTS = 5;

/** Ids per page when enumerating the vector index. 505 rows ≈ 3 requests. */
const ID_PAGE_SIZE = 200;

/**
 * Hard ceiling on how many pages a prune will walk, so a server that always returns a full page
 * and a cursor cannot spin forever. 200 pages × 200 ids = 40k, far above any real collection.
 */
const MAX_ID_PAGES = 200;

/**
 * Refuse to prune if more than this share of the index looks orphaned.
 *
 * A prune deletes on the basis of ABSENCE, so it is only ever as trustworthy as the id set it
 * diffs against. If a Postgres read silently returned a short list, every missing row would look
 * like an orphan — and we would delete a working index. A genuine orphan population is small
 * (drift from hard deletes), so a large ratio is far more likely to mean "our own view of the
 * truth is broken" than "the index is mostly garbage". Refusing costs one investigation; deleting
 * costs a full re-embed of everything.
 */
const MAX_ORPHAN_RATIO = 0.2;

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
   * against live Postgres rows.
   *
   * Repair comes in TWO halves, and it matters which one heals what: reindexAll() only pushes
   * Postgres → Weaviate, so it heals a MISSING or stale vector but can never remove one;
   * pruneOrphanedVectors() is the only thing that deletes a vector whose row is gone.
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

  /**
   * Delete vectors whose Postgres row no longer exists at all.
   *
   * WHY THIS IS SEPARATE FROM reindexAll(): that method only ever PUSHES Postgres → Weaviate, so
   * it can create and refresh vectors but never remove one. Soft deletes are handled on the write
   * path (removeQuietly), and a soft-deleted row is legitimately absent from the index. What
   * nothing handled is a HARD-deleted row: nothing fires, so its vector lingers permanently.
   *
   * Such an orphan is never *surfaced* — findDuplicates re-validates every candidate against live
   * Postgres rows — but it still occupies one of the top-N slots the similarity search returns, so
   * a real duplicate can be pushed out of the candidate set before that filter ever runs. The
   * failure mode is a duplicate check that quietly gets worse as the index ages.
   *
   * ally-be stays the authority: ally-ai only enumerates ids and never decides what is stale.
   *
   * TWO GUARD RAILS, because this deletes on the basis of ABSENCE:
   *  1. The Postgres id fetch must succeed COMPLETELY, and includes soft-deleted rows. A partial
   *     read would make live rows look orphaned; forgetting soft-deleted rows would delete
   *     vectors that removeQuietly is expected to have already handled and re-create churn.
   *  2. If the orphan ratio exceeds MAX_ORPHAN_RATIO the sweep deletes NOTHING and says why.
   */
  async pruneOrphanedVectors(): Promise<PruneVectorsResponseDto> {
    // EVERY id, soft-deleted included. `withDeleted` matters: without it a soft-deleted row looks
    // identical to a hard-deleted one, and we would delete its vector on a path that already has
    // an owner.
    const rows = await this.opportunityRepository.find({
      select: { id: true },
      withDeleted: true,
    });
    const known = new Set(rows.map((row) => row.id));

    if (known.size === 0) {
      // An empty table with a populated index is exactly what a broken read looks like. Deleting
      // the whole index on that basis is the worst outcome available, so refuse.
      const reason =
        'Postgres returned zero opportunities; refusing to treat the entire index as orphaned';
      this.logger.error(`[ROADMAP] Prune aborted: ${reason}`);
      return {
        scanned: 0,
        orphansDeleted: 0,
        failed: 0,
        abortedReason: reason,
      };
    }

    const indexed: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_ID_PAGES; page += 1) {
      const response = await this.aiService.listRoadmapOpportunityIds(
        ID_PAGE_SIZE,
        cursor,
      );
      indexed.push(...(response?.ids ?? []));
      cursor = response?.next_cursor ?? undefined;
      if (!cursor) break;

      if (page === MAX_ID_PAGES - 1) {
        // Report the truncation rather than pruning against a partial enumeration — the ids we
        // never saw are not orphans, they are ids we failed to look at.
        const reason = `Stopped after ${MAX_ID_PAGES} pages (${indexed.length} ids) without reaching the end of the index`;
        this.logger.error(`[ROADMAP] Prune aborted: ${reason}`);
        return {
          scanned: indexed.length,
          orphansDeleted: 0,
          failed: 0,
          abortedReason: reason,
        };
      }
    }

    const orphans = indexed.filter((id) => !known.has(id));
    const ratio = indexed.length ? orphans.length / indexed.length : 0;

    if (ratio > MAX_ORPHAN_RATIO) {
      // One decimal place, because rounding to whole percent prints the nonsense "20% is above
      // the 20% ceiling" for any ratio just over the line — which reads like a bug in the guard
      // rather than the reason the sweep stopped.
      const reason =
        `${orphans.length} of ${indexed.length} vectors (${(ratio * 100).toFixed(1)}%) look ` +
        `orphaned, above the ${(MAX_ORPHAN_RATIO * 100).toFixed(0)}% ceiling. This is far more ` +
        `likely to mean our id set is incomplete than that the index is mostly stale, so nothing ` +
        `was deleted.`;
      this.logger.error(`[ROADMAP] Prune aborted: ${reason}`);
      return {
        scanned: indexed.length,
        orphansDeleted: 0,
        failed: 0,
        abortedReason: reason,
      };
    }

    let orphansDeleted = 0;
    let failed = 0;
    for (const id of orphans) {
      try {
        await this.aiService.deleteRoadmapOpportunity(id);
        orphansDeleted += 1;
        // Logged individually and at info level on purpose: this is an irreversible delete driven
        // by inference, so the trail has to name every id it acted on.
        this.logger.info(
          `[ROADMAP] Pruned orphaned vector ${id} (no Postgres row, not even soft-deleted)`,
        );
      } catch (error) {
        failed += 1;
        this.logger.error(
          `[ROADMAP] Failed to prune orphaned vector ${id}: ${(error as Error)?.message}`,
        );
      }
    }

    this.logger.info(
      `[ROADMAP] Prune complete: scanned=${indexed.length} known=${known.size} ` +
        `orphansDeleted=${orphansDeleted} failed=${failed}`,
    );
    return {
      scanned: indexed.length,
      orphansDeleted,
      failed,
      abortedReason: null,
    };
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
