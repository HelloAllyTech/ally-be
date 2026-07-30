import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';

import { RoadmapAllocation } from '../entity/roadmap-allocation.entity';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';
import { largestRemainderSplit } from '../util/largest-remainder.util';
import { COINS_PER_MONTH } from '../constants/product-roadmap.constants';
import {
  MergeOpportunitiesDto,
  SplitPartDto,
} from '../dto/roadmap-opportunity.dto';
import { RoadmapVectorService } from './roadmap-vector.service';
import { RoadmapNotificationService } from './roadmap-notification.service';

/**
 * Split and merge: reshaping opportunities after people have already voted on them.
 *
 * WHY THIS IS A SERVICE TRANSACTION AND NOT plpgsql. The source implemented both as
 * SECURITY DEFINER functions for exactly one reason, stated in its own schema comment: the
 * `write allocs` RLS policy only let a user touch their OWN allocation rows, so an admin could
 * not redistribute everyone else's votes from the browser. ally-be IS the trusted writer, so
 * that constraint is gone — and what remained of the plpgsql was pure downside: logic invisible
 * to code review, untestable in Jest, versioned in a migration instead of next to the entities,
 * and needing the `app.bypass_stage_check` GUC hack to defeat its own trigger.
 *
 * The source's temp tables (_split_src, _merge_rollup) were snapshots so the function could
 * mutate `allocations` while iterating it. TypeORM's find() already materialises rows into JS
 * before we mutate, so the snapshot is free.
 *
 * THE INVARIANT BOTH OPERATIONS PRESERVE: for every (user, period) pair, the total coins that
 * user had committed across the affected opportunities is identical before and after. Coins are
 * never created or destroyed. Both are covered by randomised conservation tests.
 */
@Injectable()
export class RoadmapSplitMergeService {
  private readonly logger = LoggerService.getInstance(
    RoadmapSplitMergeService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly vectorService: RoadmapVectorService,
    private readonly notifications: RoadmapNotificationService,
  ) {}

  /**
   * Split one opportunity into N parts, redistributing every contributor's coins by weight.
   *
   * Exactly one part must carry the source's id — that part is KEPT (and reworded) rather than
   * recreated, so its comments, its history, and any external link to /?opportunity=<id> survive.
   */
  async split(
    actingUserId: number,
    sourceId: string,
    parts: SplitPartDto[],
  ): Promise<{ partIds: string[] }> {
    this.validateSplit(sourceId, parts);
    const weights = parts.map((p) => p.weight);

    const partIds = await this.dataSource.transaction(async (manager) => {
      // Lock the source so two concurrent splits cannot both read the same allocations and
      // each redistribute them.
      const source = await manager.findOne(RoadmapOpportunity, {
        where: { id: sourceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!source)
        throw new NotFoundException(`Opportunity ${sourceId} not found`);

      // 1. Snapshot the allocations BEFORE touching anything, in a deterministic lock order.
      const original = await manager
        .createQueryBuilder(RoadmapAllocation, 'a')
        .setLock('pessimistic_write')
        .where('a."opportunityId" = :sourceId', { sourceId })
        .orderBy('a."userId"', 'ASC')
        .addOrderBy('a."periodKey"', 'ASC')
        .getMany();

      // 2. Resolve every part to an id, preserving the caller's order so it lines up with
      //    `weights`.
      const ids: string[] = [];
      for (const part of parts) {
        if (part.id) {
          await manager.update(RoadmapOpportunity, part.id, {
            description: part.description.trim(),
            updatedBy: actingUserId,
          });
          ids.push(part.id);
        } else {
          const created = await manager.save(
            manager.create(RoadmapOpportunity, {
              description: part.description.trim(),
              type: source.type,
              stage: source.stage,
              productGoal: source.productGoal,
              owner: source.owner,
              // The original author keeps authorship of the ideas their opportunity became.
              createdBy: source.createdBy,
              updatedBy: actingUserId,
              // CRITICAL: inherit, never re-stamp. This is precisely why the released-at rule
              // lives in the service and not in a trigger.
              releasedAt:
                source.stage === RoadmapOpportunityStage.RELEASED
                  ? (source.releasedAt ?? null)
                  : null,
              prd: null,
            }),
          );
          ids.push(created.id);
        }
      }

      // 3. Redistribute. ORDER MATTERS: delete every original allocation row FIRST, then
      //    insert the new ones. Otherwise the monthly-cap trigger sees a transient state where
      //    a user holds their original coins AND their new shares — over 100 — and rejects a
      //    legitimate split. (The source dodged this with set_config('app.bypass_stage_check');
      //    we simply never create the invalid intermediate state.)
      await manager.delete(RoadmapAllocation, { opportunityId: sourceId });

      for (const row of original) {
        const shares = largestRemainderSplit(row.coins, weights);

        // Coin-conservation guard. largestRemainderSplit is exact by construction, so this
        // firing means the util was changed and a test was not — fail loudly inside the
        // transaction rather than silently losing someone's votes.
        const total = shares.reduce((a, b) => a + b, 0);
        if (total !== row.coins) {
          throw new Error(
            `Split would not conserve coins for user ${row.userId} in ${row.periodKey}: ` +
              `${row.coins} became ${total}`,
          );
        }

        for (const [index, coins] of shares.entries()) {
          if (coins <= 0) continue;
          await manager.save(
            manager.create(RoadmapAllocation, {
              userId: row.userId,
              opportunityId: ids[index],
              periodKey: row.periodKey,
              coins,
            }),
          );
        }
      }

      return ids;
    });

    // Re-index outside the transaction: the kept part's description changed and every new part
    // is unknown to the vector store.
    for (const id of partIds) await this.vectorService.indexQuietly(id);

    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: actingUserId,
      reason: 'split',
    });
    this.logger.info(
      `[ROADMAP] Split ${sourceId} into ${partIds.length} parts by user ${actingUserId}`,
    );
    return { partIds };
  }

  /**
   * Fold several opportunities into one, summing each contributor's coins per (user, period)
   * and moving comments across. Sources are soft-deleted, so release notes that snapshotted
   * their ids still resolve.
   */
  async merge(
    actingUserId: number,
    dto: MergeOpportunitiesDto,
  ): Promise<{ primaryId: string }> {
    const sourceIds = [...new Set(dto.sourceIds)].filter(
      (id) => id !== dto.primaryId,
    );
    if (sourceIds.length === 0) {
      throw new BadRequestException(
        'A merge needs at least one source opportunity other than the primary',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const primary = await manager.findOne(RoadmapOpportunity, {
        where: { id: dto.primaryId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!primary) {
        throw new NotFoundException(`Opportunity ${dto.primaryId} not found`);
      }

      const sources = await manager
        .createQueryBuilder(RoadmapOpportunity, 'o')
        .setLock('pessimistic_write')
        .where('o.id IN (:...sourceIds)', { sourceIds })
        .orderBy('o.id', 'ASC')
        .getMany();
      if (sources.length !== sourceIds.length) {
        const found = new Set(sources.map((s) => s.id));
        throw new NotFoundException(
          `Not found or already merged: ${sourceIds.filter((id) => !found.has(id)).join(', ')}`,
        );
      }

      const allIds = [dto.primaryId, ...sourceIds];

      // Roll up per (user, period) across the primary AND every source.
      const rows = await manager
        .createQueryBuilder(RoadmapAllocation, 'a')
        .setLock('pessimistic_write')
        .where('a."opportunityId" IN (:...allIds)', { allIds })
        .orderBy('a."userId"', 'ASC')
        .addOrderBy('a."periodKey"', 'ASC')
        .getMany();

      const rollup = new Map<string, number>();
      let totalBefore = 0;
      for (const row of rows) {
        const key = `${row.userId}|${row.periodKey}`;
        rollup.set(key, (rollup.get(key) ?? 0) + row.coins);
        totalBefore += row.coins;
      }

      // Same ordering rule as split: clear first, then write, so the cap trigger never sees a
      // user holding their coins on two opportunities at once.
      await manager.query(
        `DELETE FROM roadmap_allocations WHERE "opportunityId" = ANY($1::uuid[])`,
        [allIds],
      );

      let totalAfter = 0;
      for (const [key, coins] of rollup) {
        const [userIdRaw, periodKey] = key.split('|');

        // A rollup can NEVER legitimately exceed the cap: a user's total across ALL
        // opportunities in a month is already capped at 100, so their total across a subset
        // cannot be higher. If it is, the data is corrupt (a breach that predates the trigger,
        // or a writer that bypassed this service).
        //
        // Deliberately throw rather than clamp. Clamping would silently destroy votes and
        // quietly break the conservation invariant this whole class exists to preserve — and
        // the operator would never know. A failed merge inside a transaction leaves the board
        // untouched and demands attention, which is the correct outcome.
        if (coins > COINS_PER_MONTH) {
          throw new ConflictException(
            `Cannot merge: user ${userIdRaw} holds ${coins} coins across these opportunities ` +
              `in ${periodKey}, above the ${COINS_PER_MONTH}-coin cap. That should be ` +
              `impossible — investigate the allocation data before retrying.`,
          );
        }

        totalAfter += coins;
        await manager.save(
          manager.create(RoadmapAllocation, {
            userId: Number(userIdRaw),
            opportunityId: dto.primaryId,
            periodKey,
            coins,
          }),
        );
      }

      // The invariant, asserted. Unreachable given the guard above; kept because it is the one
      // number the whole feature depends on.
      if (totalAfter !== totalBefore) {
        throw new Error(
          `Merge did not conserve coins: ${totalBefore} before, ${totalAfter} after`,
        );
      }

      // Move comments to the survivor.
      await manager.query(
        `UPDATE roadmap_opportunity_comments SET "opportunityId" = $1, "updatedAt" = now()
          WHERE "opportunityId" = ANY($2::uuid[])`,
        [dto.primaryId, sourceIds],
      );

      if (dto.description) {
        await manager.update(RoadmapOpportunity, dto.primaryId, {
          description: dto.description.trim(),
          updatedBy: actingUserId,
        });
      }

      await manager.softDelete(RoadmapOpportunity, sourceIds);
    });

    // Every source must leave the vector index, or duplicate-detection keeps proposing
    // opportunities that no longer exist.
    for (const id of sourceIds) await this.vectorService.removeQuietly(id);
    if (dto.description) await this.vectorService.indexQuietly(dto.primaryId);

    this.notifications.emit({
      kind: 'ROADMAP_INVALIDATED',
      actorId: actingUserId,
      reason: 'merge',
    });
    this.logger.info(
      `[ROADMAP] Merged ${sourceIds.length} opportunities into ${dto.primaryId} by user ${actingUserId}`,
    );
    return { primaryId: dto.primaryId };
  }

  /** Validated before opening a transaction, so a bad request costs nothing. */
  private validateSplit(sourceId: string, parts: SplitPartDto[]): void {
    if (!Array.isArray(parts) || parts.length < 2) {
      throw new BadRequestException('A split needs at least 2 parts');
    }
    const carryingSourceId = parts.filter((p) => p.id === sourceId);
    if (carryingSourceId.length !== 1) {
      throw new BadRequestException(
        'Exactly one part must carry the original opportunity id',
      );
    }
    if (parts.some((p) => p.id && p.id !== sourceId)) {
      throw new BadRequestException(
        'Only the original opportunity may carry an id; new parts must omit it',
      );
    }
    const weights = parts.map((p) => p.weight);
    if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
      throw new BadRequestException(
        'Every weight must be a non-negative number',
      );
    }
    if (weights.reduce((a, b) => a + b, 0) <= 0) {
      throw new BadRequestException('Weights must sum to more than 0');
    }
  }
}
