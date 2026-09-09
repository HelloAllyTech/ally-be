import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RoadmapVoteGrant } from '../entity/roadmap-vote-grant.entity';
import {
  ROADMAP_VOTE_GRANT_EXPIRY_DAYS,
  ROADMAP_VOTE_GRANT_MONTHLY,
  ROADMAP_VOTE_GRANT_DAILY,
} from '../constants/product-roadmap.constants';

const EXPIRY_INTERVAL_MS = ROADMAP_VOTE_GRANT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

@Injectable()
export class RoadmapVoteGrantRepository extends Repository<RoadmapVoteGrant> {
  constructor(private readonly dataSource: DataSource) {
    super(RoadmapVoteGrant, dataSource.createEntityManager());
  }

  /** This user's live, spendable balance: every unexpired grant, minus what's already drawn. */
  async availableBalance(
    manager: EntityManager,
    userId: number,
  ): Promise<number> {
    const rows = await manager.query<{ total: string | null }[]>(
      `SELECT COALESCE(SUM("amount" - "consumed"), 0) AS total
         FROM roadmap_vote_grants
        WHERE "userId" = $1 AND "expiresAt" > now()`,
      [userId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Spend `amount` from this user's grants, oldest-`expiresAt`-first — whichever grant would
   * otherwise be wasted first is the one drawn down. Caller (RoadmapAllocationService) has
   * already confirmed availableBalance() >= amount under the per-user advisory lock, so this
   * never needs to fail partway; it just walks eligible rows until the amount is exhausted.
   */
  async consume(
    manager: EntityManager,
    userId: number,
    amount: number,
  ): Promise<void> {
    let remaining = amount;
    const grants = await manager.query<
      { id: string; amount: number; consumed: number }[]
    >(
      `SELECT "id", "amount", "consumed" FROM roadmap_vote_grants
        WHERE "userId" = $1 AND "expiresAt" > now() AND "consumed" < "amount"
        ORDER BY "expiresAt" ASC`,
      [userId],
    );

    for (const grant of grants) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, grant.amount - grant.consumed);
      await manager.query(
        `UPDATE roadmap_vote_grants SET "consumed" = "consumed" + $1, "updatedAt" = now() WHERE "id" = $2`,
        [take, grant.id],
      );
      remaining -= take;
    }
  }

  /**
   * Credit `amount` back as a brand-new 30-day grant, rather than reversing it onto whichever
   * grant(s) it was originally drawn from. There's no per-unit journal of that, and a fresh
   * grant is simpler, always correct (never risks negative `consumed` or crediting an
   * already-expired row), and defensible on its own: un-voting gives the credit a full new
   * window to be used. See RoadmapVoteGrant's docblock.
   */
  async refund(
    manager: EntityManager,
    userId: number,
    amount: number,
  ): Promise<void> {
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + EXPIRY_INTERVAL_MS);
    await manager.query(
      `INSERT INTO roadmap_vote_grants ("userId", "source", "amount", "grantedAt", "expiresAt", "grantKey")
       VALUES ($1, 'refund', $2, $3, $4, NULL)`,
      [userId, amount, grantedAt, expiresAt],
    );
  }

  /** Idempotent monthly issuance — see grantKey's ON CONFLICT DO NOTHING semantics. */
  async grantMonthly(
    manager: EntityManager,
    userId: number,
    periodKey: string,
  ): Promise<void> {
    await this.issue(
      manager,
      userId,
      'monthly',
      ROADMAP_VOTE_GRANT_MONTHLY,
      periodKey,
    );
  }

  /** Idempotent daily issuance — see grantKey's ON CONFLICT DO NOTHING semantics. */
  async grantDaily(
    manager: EntityManager,
    userId: number,
    dayKey: string,
  ): Promise<void> {
    await this.issue(
      manager,
      userId,
      'daily',
      ROADMAP_VOTE_GRANT_DAILY,
      dayKey,
    );
  }

  private async issue(
    manager: EntityManager,
    userId: number,
    source: 'monthly' | 'daily',
    amount: number,
    grantKey: string,
  ): Promise<void> {
    const grantedAt = new Date();
    const expiresAt = new Date(grantedAt.getTime() + EXPIRY_INTERVAL_MS);
    await manager.query(
      `INSERT INTO roadmap_vote_grants ("userId", "source", "amount", "grantedAt", "expiresAt", "grantKey")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("userId", "source", "grantKey") WHERE "grantKey" IS NOT NULL DO NOTHING`,
      [userId, source, amount, grantedAt, expiresAt, grantKey],
    );
  }
}
