import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds XP from history so the Progress dashboard does not launch showing every existing
 * learner at level 1 with thousands of practice minutes behind them.
 *
 * Backfilled rows carry sourceType 'backfill' and a deterministic sourceId, so they are
 * distinguishable from live awards, cannot collide with them, and a re-run inserts
 * nothing.
 *
 * Two rules are deliberately NOT backfilled. The streak multiplier needs the streak that
 * was live on each historical day, which the daily-score rollup cannot reconstruct.
 * Skill personal bests need per-session ordering of scores that were re-derived over
 * time. Inventing either would hand out XP the rules never actually earned; both simply
 * start accruing from launch.
 *
 * The practice award is capped per day the same way the live path caps it, so a learner
 * with one enormous historical day is not vaulted up the ladder by it.
 */
export class BackfillLearnerXp1950100000000 implements MigrationInterface {
  name = 'BackfillLearnerXp1950100000000';

  /** Mirrors XP_AWARD and DAILY_PRACTICE_XP_CAP in src/progress/progress.constants.ts. */
  private readonly DAILY_PRACTICE_XP_CAP = 300;
  private readonly PER_SESSION_COMPLETED = 10;
  private readonly PER_TRACK_ITEM_COMPLETED = 25;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A tenant is spelled two ways across these tables — its uuid in some rows, its
    // short code in others, sometimes both within one table. Every source below is
    // resolved through `tenants` to the uuid first, because keying the ledger on the
    // raw value would give a learner two `user_progress` rows, one per spelling, each
    // showing part of their XP.
    const CANONICAL_TENANT = `LEFT JOIN "tenants" tn ON tn."id"::text = %ALIAS% OR tn."code" = %ALIAS%`;
    const canonicalJoin = (aliasedColumn: string): string =>
      CANONICAL_TENANT.split('%ALIAS%').join(aliasedColumn);

    // ── practice minutes, from the sanctioned daily rollup ───────────────────
    await queryRunner.query(
      `INSERT INTO "xp_events" ` +
        `("userId", "tenant_id", "rule", "sourceType", "sourceId", "xp", "awardedOn") ` +
        `SELECT d."userId", COALESCE(tn."id"::text, d."tenant_id"), 'PRACTICE_MINUTE', 'backfill', ` +
        `'practice-' || to_char(d."date", 'YYYY-MM-DD'), ` +
        `LEAST(FLOOR(d."minutesPlayed")::int, $1), d."date" ` +
        `FROM "user_daily_scores" d ` +
        `${canonicalJoin('d."tenant_id"')} ` +
        `WHERE d."minutesPlayed" >= 1 ` +
        `ON CONFLICT ("userId", "tenant_id", "rule", "sourceType", "sourceId") DO NOTHING`,
      [this.DAILY_PRACTICE_XP_CAP],
    );

    // ── completed roleplay sessions ──────────────────────────────────────────
    // Two sessions for the same learner on the same day under different spellings of
    // the tenant collapse to one canonical tenant here, but keep distinct sourceIds,
    // so both still earn their completion award.
    await queryRunner.query(
      `INSERT INTO "xp_events" ` +
        `("userId", "tenant_id", "rule", "sourceType", "sourceId", "xp", "awardedOn") ` +
        `SELECT s."counselorId", COALESCE(tn."id"::text, s."tenant_id"), 'SESSION_COMPLETED', 'backfill', ` +
        `'session-' || s."id"::text, $1, s."endedAt"::date ` +
        `FROM "scenario_sessions" s ` +
        `${canonicalJoin('s."tenant_id"')} ` +
        `WHERE s."eventStatus" = 'COMPLETED' AND s."endedAt" IS NOT NULL ` +
        `ON CONFLICT ("userId", "tenant_id", "rule", "sourceType", "sourceId") DO NOTHING`,
      [this.PER_SESSION_COMPLETED],
    );

    // ── completed track items ────────────────────────────────────────────────
    // track_item_progress has no tenant of its own; it inherits the enrolment's, which
    // is a real uuid column rather than the varchar the other tables use.
    await queryRunner.query(
      `INSERT INTO "xp_events" ` +
        `("userId", "tenant_id", "rule", "sourceType", "sourceId", "xp", "awardedOn") ` +
        `SELECT p."userId", e."tenantId"::text, 'TRACK_ITEM_COMPLETED', 'backfill', ` +
        `'track-item-' || p."trackItemId"::text, $1, p."completedAt"::date ` +
        `FROM "track_item_progress" p ` +
        `JOIN "track_enrollments" e ON e."id" = p."trackEnrollmentId" ` +
        `WHERE p."status" = 'COMPLETED' AND p."completedAt" IS NOT NULL ` +
        `AND p."deletedAt" IS NULL AND e."tenantId" IS NOT NULL ` +
        `ON CONFLICT ("userId", "tenant_id", "rule", "sourceType", "sourceId") DO NOTHING`,
      [this.PER_TRACK_ITEM_COMPLETED],
    );

    // ── rebuild the rollup from the ledger ───────────────────────────────────
    // The level CASE mirrors LEVEL_THRESHOLDS at the time of writing. The read path
    // recomputes the level from totalXp on every request, so a later change to the
    // ladder corrects displayed levels on its own; this column only has to be right
    // enough that the next award does not report a spurious level-up.
    await queryRunner.query(
      `INSERT INTO "user_progress" ("userId", "tenant_id", "totalXp", "level") ` +
        `SELECT x."userId", x."tenant_id", SUM(x."xp")::int, ` +
        `CASE ` +
        `WHEN SUM(x."xp") >= 11287 THEN 10 ` +
        `WHEN SUM(x."xp") >= 6992 THEN 9 ` +
        `WHEN SUM(x."xp") >= 4308 THEN 8 ` +
        `WHEN SUM(x."xp") >= 2630 THEN 7 ` +
        `WHEN SUM(x."xp") >= 1581 THEN 6 ` +
        `WHEN SUM(x."xp") >= 926 THEN 5 ` +
        `WHEN SUM(x."xp") >= 516 THEN 4 ` +
        `WHEN SUM(x."xp") >= 260 THEN 3 ` +
        `WHEN SUM(x."xp") >= 100 THEN 2 ` +
        `ELSE 1 END ` +
        `FROM "xp_events" x GROUP BY x."userId", x."tenant_id" ` +
        `ON CONFLICT ("userId", "tenant_id") DO UPDATE SET ` +
        `"totalXp" = EXCLUDED."totalXp", "level" = EXCLUDED."level", "updatedAt" = now()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "xp_events" WHERE "sourceType" = 'backfill'`,
    );
    // Rebuild the rollup from whatever ledger rows survive, dropping learners left with
    // none. A plain TRUNCATE would also discard XP earned live since the backfill ran.
    await queryRunner.query(
      `DELETE FROM "user_progress" up WHERE NOT EXISTS (` +
        `SELECT 1 FROM "xp_events" x ` +
        `WHERE x."userId" = up."userId" AND x."tenant_id" = up."tenant_id")`,
    );
    await queryRunner.query(
      `UPDATE "user_progress" up SET "totalXp" = agg.total, "updatedAt" = now() ` +
        `FROM (SELECT "userId", "tenant_id", SUM("xp")::int AS total ` +
        `FROM "xp_events" GROUP BY "userId", "tenant_id") agg ` +
        `WHERE agg."userId" = up."userId" AND agg."tenant_id" = up."tenant_id"`,
    );
  }
}
