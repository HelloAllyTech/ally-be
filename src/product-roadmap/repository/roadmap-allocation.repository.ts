import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoadmapAllocation } from '../entity/roadmap-allocation.entity';

@Injectable()
export class RoadmapAllocationRepository extends Repository<RoadmapAllocation> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapAllocation, dataSource.createEntityManager());
  }

  /**
   * Serialise this user's allocation writes for this period inside the current transaction.
   *
   * MUST be called before summing in setVotes(). Without it, two concurrent writes both read
   * a stale total under READ COMMITTED and the service-level cap check passes for both — the
   * DB trigger then rejects one of them with a 500-shaped error instead of the API returning a
   * clean 422. That is not a theoretical race: the vote control debounces autosave, so the
   * same person with two tabs open, a double-fired debounce, or an axios retry all produce
   * concurrent writes for the same (userId, periodKey).
   *
   * An advisory lock rather than SELECT ... FOR UPDATE because FOR UPDATE cannot lock the
   * FIRST insert in a period — there are no rows yet to lock.
   *
   * pg_advisory_xact_lock releases automatically at COMMIT or ROLLBACK, so there is no
   * unlock path to forget. Two-int form: hashtext of the composite key, so the pair is
   * derived deterministically from (userId, periodKey).
   */
  async lockUserPeriod(
    manager: EntityManager,
    userId: number,
    periodKey: string,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [`roadmap:allocation:${userId}`, periodKey],
    );
  }

  /**
   * Votes this user has already cast in this period, EXCLUDING the given opportunity.
   *
   * The exclusion is what makes "raise my own vote from 40 to 60 while holding 40 elsewhere"
   * legal: without it the row being updated is counted twice and a legitimate edit fails with
   * a spurious cap error. The same self-exclusion exists in roadmap_enforce_monthly_cap(),
   * written against both `id` and `opportunityId`. Covered by a test named for this case.
   */
  async sumForPeriodExcluding(
    manager: EntityManager,
    userId: number,
    periodKey: string,
    excludeOpportunityId?: string,
  ): Promise<number> {
    const rows = await manager.query<{ total: string | null }[]>(
      `SELECT COALESCE(SUM(votes), 0) AS total
         FROM roadmap_allocations
        WHERE "userId" = $1
          AND "periodKey" = $2
          AND ($3::uuid IS NULL OR "opportunityId" IS DISTINCT FROM $3::uuid)`,
      [userId, periodKey, excludeOpportunityId ?? null],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Total votes this user has cast in the period, across all opportunities. */
  async sumForPeriod(userId: number, periodKey: string): Promise<number> {
    const rows = await this.dataSource.query<{ total: string | null }[]>(
      `SELECT COALESCE(SUM(votes), 0) AS total
         FROM roadmap_allocations WHERE "userId" = $1 AND "periodKey" = $2`,
      [userId, periodKey],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Sum of every user's votes on one opportunity, across every period — the priority score. */
  async scoreForOpportunity(opportunityId: string): Promise<number> {
    const rows = await this.dataSource.query<{ total: string | null }[]>(
      `SELECT COALESCE(SUM(votes), 0) AS total
         FROM roadmap_allocations WHERE "opportunityId" = $1`,
      [opportunityId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Every allocation on an opportunity, in a deterministic order.
   *
   * The ORDER BY is not cosmetic: split and merge lock these rows, and taking them in a
   * stable order across concurrent operations is what prevents a deadlock between two admins
   * splitting overlapping sets at the same time.
   */
  async findForOpportunity(
    manager: EntityManager,
    opportunityId: string,
    lock = false,
  ): Promise<RoadmapAllocation[]> {
    const qb = manager
      .createQueryBuilder(RoadmapAllocation, 'a')
      .where('a."opportunityId" = :opportunityId', { opportunityId })
      .orderBy('a."userId"', 'ASC')
      .addOrderBy('a."periodKey"', 'ASC');
    if (lock) qb.setLock('pessimistic_write');
    return qb.getMany();
  }
}
