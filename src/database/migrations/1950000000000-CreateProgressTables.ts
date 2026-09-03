import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Learner Progress — XP ledger and per-learner rollup.
 *
 * `xp_events` is append-only. The unique index across
 * (userId, tenant_id, rule, sourceType, sourceId) is the idempotency guarantee: session
 * end is reachable twice (a redelivered SQS message, and the unfinalised-session
 * sweeper), and without it a replay would inflate a learner's level. `sourceId` is NOT
 * NULL for the same reason — Postgres treats NULLs as distinct in a unique index, so a
 * nullable column would quietly switch the guarantee off.
 *
 * `user_progress` is the rollup the persistent nav indicator reads. It stores XP state
 * only. Lifetime practice minutes stay in `user_daily_scores."minutesPlayed"`, which is
 * the sanctioned source the certification chart and badge ladders already read; a copy
 * here would let the same learner see two different lifetime totals.
 */
export class CreateProgressTables1950000000000 implements MigrationInterface {
  name = 'CreateProgressTables1950000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── XP ledger ────────────────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "xp_events" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"userId" integer NOT NULL, ` +
        `"rule" character varying(64) NOT NULL, ` +
        `"sourceType" character varying(32) NOT NULL, ` +
        `"sourceId" character varying(128) NOT NULL, ` +
        `"xp" integer NOT NULL, ` +
        `"awardedOn" date NOT NULL, ` +
        `CONSTRAINT "PK_xp_events_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "CHK_xp_events_xp_nonnegative" CHECK ("xp" >= 0))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_xp_events_user_rule_source" ` +
        `ON "xp_events" ("userId", "tenant_id", "rule", "sourceType", "sourceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_xp_events_user_tenant_awarded_on" ` +
        `ON "xp_events" ("userId", "tenant_id", "awardedOn")`,
    );

    // ── per-learner rollup ───────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "user_progress" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"userId" integer NOT NULL, ` +
        `"totalXp" integer NOT NULL DEFAULT 0, ` +
        `"level" integer NOT NULL DEFAULT 1, ` +
        `"lastLevelUpAt" TIMESTAMP, ` +
        `"lastAwardedAt" TIMESTAMP, ` +
        `CONSTRAINT "PK_user_progress_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "CHK_user_progress_total_xp_nonnegative" CHECK ("totalXp" >= 0), ` +
        // Upper bound deliberately omitted: MAX_LEVEL lives in code, and pinning it here
        // would make raising the ladder a schema change.
        `CONSTRAINT "CHK_user_progress_level_min" CHECK ("level" >= 1))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_progress_user_tenant" ` +
        `ON "user_progress" ("userId", "tenant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_progress"`);
    await queryRunner.query(`DROP TABLE "xp_events"`);
  }
}
