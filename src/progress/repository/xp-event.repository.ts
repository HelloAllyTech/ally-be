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
   * MUST be called before any of the cap reads below. Without
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
   * XP already banked today under the given rules, used to apply a daily cap.
   *
   * Takes the rule set rather than naming one, because every source now has its own
   * cap and they are all evaluated the same way. Passing an empty set returns 0 rather
   * than summing the whole day — an empty `= ANY('{}')` matches nothing in Postgres, but
   * being explicit stops a caller with a mis-built rule list silently reading zero and
   * concluding it has full allowance.
   */
  async getXpAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    rules: readonly string[],
  ): Promise<number> {
    if (rules.length === 0) return 0;

    const rows: { total: string | null }[] = await manager.query(
      `SELECT COALESCE(SUM("xp"), 0) AS total FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 ` +
        `AND "rule" = ANY($4::character varying[])`,
      [userId, tenantId, awardedOn, rules],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Total XP banked today across every rule except those explicitly outside the daily
   * ceiling. Used for the overall ceiling, which sits above the per-source caps.
   */
  async getCappedXpAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    exemptRules: readonly string[],
  ): Promise<number> {
    const rows: { total: string | null }[] = await manager.query(
      `SELECT COALESCE(SUM("xp"), 0) AS total FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 ` +
        `AND NOT ("rule" = ANY($4::character varying[]))`,
      [userId, tenantId, awardedOn, exemptRules],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * How many distinct days in [start, end] earned XP under a qualifying rule.
   *
   * Bonus rules are excluded by the caller so the weekly consistency award cannot make
   * its own day qualify — without that the rule feeds itself, since a day qualifies by
   * earning XP and qualifying pays XP.
   */
  async countQualifyingDaysBetween(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    startDate: string,
    endDate: string,
    excludedRules: readonly string[],
  ): Promise<number> {
    const rows: { count: string }[] = await manager.query(
      `SELECT COUNT(DISTINCT "awardedOn")::int AS count FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 ` +
        `AND "awardedOn" >= $3::date AND "awardedOn" <= $4::date ` +
        `AND "xp" > 0 ` +
        `AND NOT ("rule" = ANY($5::character varying[]))`,
      [userId, tenantId, startDate, endDate, excludedRules],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Whether a once-per-period award has already landed, by its synthetic source id. */
  async hasAward(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    rule: string,
    sourceType: string,
    sourceId: string,
  ): Promise<boolean> {
    const rows: { exists: boolean }[] = await manager.query(
      `SELECT EXISTS (SELECT 1 FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "rule" = $3 ` +
        `AND "sourceType" = $4 AND "sourceId" = $5) AS "exists"`,
      [userId, tenantId, rule, sourceType, sourceId],
    );
    return Boolean(rows[0]?.exists);
  }

  /**
   * Practice minutes already credited today, read back from the ledger rather than from
   * `user_daily_scores`.
   *
   * The depth milestones have to fire off the same number the minute award used, and
   * the daily-scores row is written by a different listener on the same event — reading
   * it here would race, and would count minutes the cap refused to pay for.
   */
  async getPracticeMinutesAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
  ): Promise<number> {
    const rows: { total: string | null }[] = await manager.query(
      `SELECT COALESCE(SUM("xp"), 0) AS total FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 ` +
        `AND "rule" = $4`,
      [userId, tenantId, awardedOn, XP_RULE.PRACTICE_MINUTE],
    );
    // One XP per minute, so the practice-rule total is the minute count.
    return Number(rows[0]?.total ?? 0);
  }

  /** How many awards of one rule already landed today, for per-day count limits. */
  async countRuleAwardedOn(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    awardedOn: string,
    rule: string,
  ): Promise<number> {
    const rows: { count: string }[] = await manager.query(
      `SELECT COUNT(*)::int AS count FROM "xp_events" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 AND "awardedOn" = $3 AND "rule" = $4`,
      [userId, tenantId, awardedOn, rule],
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
