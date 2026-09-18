import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoadmapAllocation } from '../entity/roadmap-allocation.entity';

@Injectable()
export class RoadmapAllocationRepository extends Repository<RoadmapAllocation> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapAllocation, dataSource.createEntityManager());
  }

  /**
   * Serialise this user's allocation + vote-grant writes inside the current transaction.
   *
   * MUST be called before reading the grant balance in setVotes(). Without it, two concurrent
   * writes both read a stale balance under READ COMMITTED and the service-level check passes
   * for both — the DB trigger then rejects one of them with a 500-shaped error instead of the
   * API returning a clean 422. That is not a theoretical race: the vote control debounces
   * autosave, so the same person with two tabs open, a double-fired debounce, or an axios
   * retry all produce concurrent writes for the same user.
   *
   * Keyed on userId ALONE now, not (userId, periodKey) — the contested resource is this
   * user's whole grant ledger plus every allocation row that spends from it, not one period's
   * rows, since a grant issued in one calendar month can still be getting spent well into the
   * next.
   *
   * An advisory lock rather than SELECT ... FOR UPDATE because FOR UPDATE cannot lock the
   * FIRST insert for a user — there are no rows yet to lock.
   *
   * pg_advisory_xact_lock releases automatically at COMMIT or ROLLBACK, so there is no
   * unlock path to forget.
   */
  async lockUser(manager: EntityManager, userId: number): Promise<void> {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `roadmap:allocation:${userId}`,
    ]);
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
   * Per-user vote totals on one opportunity, across every period — the breakdown behind
   * priorityScore, which is just SUM(votes) over these same rows. Highest votes first;
   * ties broken by userId so the order is stable across calls.
   */
  async votersForOpportunity(
    opportunityId: string,
  ): Promise<{ userId: number; votes: number }[]> {
    const rows = await this.dataSource.query<
      { userId: number; votes: string }[]
    >(
      `SELECT "userId", SUM(votes) AS votes
         FROM roadmap_allocations
        WHERE "opportunityId" = $1
        GROUP BY "userId"
        ORDER BY SUM(votes) DESC, "userId" ASC`,
      [opportunityId],
    );
    return rows.map((r) => ({ userId: r.userId, votes: Number(r.votes) }));
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
