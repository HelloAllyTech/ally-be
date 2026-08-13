import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bug Hunter: the autonomous find-and-fix agent's kill switch, run history,
 * and event transcript. Off by default — the introducing migration seeds the
 * one settings row with `enabled = false`, so the feature ships inert and a
 * SUPER_DUPER_ADMIN has to deliberately turn it on before any trigger does
 * real work. See `BugHunterSettings` for why this is a singleton row rather
 * than a config key in an existing table, and `BugHuntEvent` for why this is
 * a new table rather than the platform `audit_logs` (a HIPAA compliance log
 * with an unrelated taxonomy).
 *
 * Hand-written SQL, per the `analytics_suggestions` precedent: the CHECK
 * constraints and FK live here only — never run `migration:generate` against
 * these tables.
 */
export class CreateBugHunter1894000000000 implements MigrationInterface {
  name = 'CreateBugHunter1894000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bug_hunter_settings" (
        "id" smallint NOT NULL DEFAULT 1,
        "enabled" boolean NOT NULL DEFAULT false,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunter_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunter_settings_singleton" CHECK ("id" = 1)
      )`,
    );
    // Seed the one row up front so `findOneOrFail` never has to special-case
    // "no settings row exists yet" — the table is created already-off.
    await queryRunner.query(
      `INSERT INTO "bug_hunter_settings" ("id", "enabled") VALUES (1, false)`,
    );

    await queryRunner.query(
      `CREATE TABLE "bug_hunt_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trigger" character varying(10) NOT NULL,
        "repo" text NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'running',
        "finishedAt" TIMESTAMP,
        "foundCount" integer NOT NULL DEFAULT 0,
        "autoMergedCount" integer NOT NULL DEFAULT 0,
        "prOpenedCount" integer NOT NULL DEFAULT 0,
        "dismissedCount" integer NOT NULL DEFAULT 0,
        "totalTokenCostUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunt_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunt_runs_trigger"
          CHECK ("trigger" IN ('scheduled', 'manual')),
        CONSTRAINT "CHK_bug_hunt_runs_status"
          CHECK ("status" IN ('running', 'completed', 'failed', 'skipped_disabled'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_runs_repo" ON "bug_hunt_runs" ("repo")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_runs_created_at" ON "bug_hunt_runs" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_runs_status" ON "bug_hunt_runs" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "bug_hunt_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid,
        "repo" text,
        "stage" character varying(20) NOT NULL,
        "summary" text NOT NULL,
        "payload" jsonb,
        "suggestionId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunt_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
          'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
          'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
          'error', 'settings_changed'
        )),
        CONSTRAINT "FK_bug_hunt_events_run_id"
          FOREIGN KEY ("runId") REFERENCES "bug_hunt_runs" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_bug_hunt_events_suggestion_id"
          FOREIGN KEY ("suggestionId") REFERENCES "analytics_suggestions" ("id")
          ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_events_run_id" ON "bug_hunt_events" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_events_created_at" ON "bug_hunt_events" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_hunt_events_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_bug_hunt_events_run_id"`);
    await queryRunner.query(`DROP TABLE "bug_hunt_events"`);
    await queryRunner.query(`DROP INDEX "public"."idx_bug_hunt_runs_status"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_hunt_runs_created_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_bug_hunt_runs_repo"`);
    await queryRunner.query(`DROP TABLE "bug_hunt_runs"`);
    await queryRunner.query(`DROP TABLE "bug_hunter_settings"`);
  }
}
