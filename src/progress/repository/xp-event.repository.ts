import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { XpEvent } from '../entity/xp-event.entity';
import { XP_RULE } from '../progress.constants';

export interface XpAwardRow {
  rule: string;
  sourceType: string;
  sourceId: string;
  xp: number;
}

@Injectable()
export class XpEventRepository extends Repository<XpEvent> {
  constructor(private dataSource: DataSource) {
    super(XpEvent, dataSource.createEntityManager());
  }

  /**
   * Inserts awards, skipping any that already exist.
   *
   * Returns the XP actually written, which is what the rollup must be incremented by —
   * a redelivered session-end conflicts on every row and correctly adds nothing. The
   * caller supplies the EntityManager so this shares the rollup's transaction.
   */
  async insertAwards(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    awards: XpAwardRow[],
  ): Promise<number> {
    const insertable = awards.filter((award) => award.xp > 0);
    if (insertable.length === 0) return 0;

    const values: unknown[] = [];
    const tuples = insertable.map((award, index) => {
      const base = index * 6;
      values.push(
        userId,
        tenantId,
        award.rule,
        award.sourceType,
        award.sourceId,
        award.xp,
      );
      return (
        `($${base + 1}, $${base + 2}, $${base + 3}, ` +
        `$${base + 4}, $${base + 5}, $${base + 6}, $${insertable.length * 6 + 1})`
      );
    });
    values.push(awardedOn);

    const inserted: { xp: number }[] = await manager.query(
      `INSERT INTO "xp_events" ` +
        `("userId", "tenant_id", "rule", "sourceType", "sourceId", "xp", "awardedOn") ` +
        `VALUES ${tuples.join(', ')} ` +
        `ON CONFLICT ("userId", "tenant_id", "rule", "sourceType", "sourceId") DO NOTHING ` +
        `RETURNING "xp"`,
      values,
    );

    return inserted.reduce((sum, row) => sum + Number(row.xp), 0);
  }

  /**
   * Serialises this user's daily-cap check-then-insert inside the current transaction.
   *
   * MUST be called before getPracticeXpAwardedOn()/countPersonalBestsAwardedOn(). Without
   * it, two SCENARIO_SESSION_ENDED events for the same learner arriving close together —
   * plausible since the unfinalised-session sweeper fires them without waiting on
   * listeners — can both read the same stale "already awarded today" total under READ
   * COMMITTED, both pass the cap check, and both insert: the ledger's unique index only
   * dedupes the *same* sourceId, not the daily total.
   *
   * An advisory lock rather than SELECT ... FOR UPDATE because there may be no
   * `xp_events` row for today yet to lock. pg_advisory_xact_lock releases automatically
   * at COMMIT or ROLLBACK, so there is no unlock path to forget.
   */
  async lockUserDay(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
  ): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [`xp-events:${userId}:${tenantId}`, awardedOn],
    );
  }

  /**
   * Practice XP already banked today, used to apply the daily cap. Counts the minute
   * award and its streak bonus only — completion, track and personal-best awards are
   * bounded by their own rules and are deliberately outside the cap.
   */
  async getPracticeXpAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
  ): Promise<number> {
    const rows: { total: string | null }[] = await manager.query(
      `SELECT COALESCE(SUM("xp"), 0) AS total FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 ` +
        `AND "rule" = ANY($4::character varying[])`,
      [
        userId,
        tenantId,
        awardedOn,
        [XP_RULE.PRACTICE_MINUTE, XP_RULE.STREAK_MULTIPLIER],
      ],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Whether a skill personal best has already been awarded today. */
  async countPersonalBestsAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
  ): Promise<number> {
    const rows: { count: string }[] = await manager.query(
      `SELECT COUNT(*)::int AS count FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 AND "rule" = $4`,
      [userId, tenantId, awardedOn, XP_RULE.SKILL_PERSONAL_BEST],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Ledger truth for one learner, used by the reconcile check. */
  async sumLedgerXp(userId: number, tenantId: string): Promise<number> {
    const rows: { total: string | null }[] = await this.query(
      `SELECT COALESCE(SUM("xp"), 0) AS total FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2`,
      [userId, tenantId],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
