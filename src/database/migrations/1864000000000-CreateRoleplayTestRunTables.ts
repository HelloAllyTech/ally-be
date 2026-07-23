import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 "Improve": trainer-driven test runs of a spec version
 * against snapshotted agent test cases, one report row per case.
 *  - roleplay_test_runs     — one batch run (config snapshot, watchdog state,
 *                             aggregate results; sourceReportId marks
 *                             auto-improve re-runs)
 *  - roleplay_test_reports  — one agent-test-case execution (test-case
 *                             snapshot, transcript, judge verdict/scores,
 *                             per-report markdown, auto-improve lineage via
 *                             improveOfReportId / improveStatus)
 *
 * Successor of the rehearsal harness dropped in migration 1856 (lean
 * trainer-driven layer — no autonomous improvement loop tables).
 */
export class CreateRoleplayTestRunTables1864000000000 implements MigrationInterface {
  name = 'CreateRoleplayTestRunTables1864000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roleplay_test_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'STARTED', "config" jsonb NOT NULL, "progress" jsonb, "resultsSummary" jsonb, "reportMarkdown" text, "metadata" jsonb, "endedAt" TIMESTAMP, "sourceReportId" uuid, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_test_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_runs_spec_id" ON "roleplay_test_runs" ("specId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_runs_spec_version_id" ON "roleplay_test_runs" ("specVersionId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_runs_source_report_id" ON "roleplay_test_runs" ("sourceReportId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "roleplay_test_reports" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "runId" uuid NOT NULL, "specId" uuid NOT NULL, "specVersionId" uuid NOT NULL, "agentTestCaseId" uuid NOT NULL, "testCaseSnapshot" jsonb NOT NULL, "status" character varying NOT NULL DEFAULT 'PENDING', "transcript" jsonb, "directorTrace" jsonb, "judgeScores" jsonb, "judgeNotes" text, "testResult" jsonb, "verdict" character varying, "overallScore" integer, "reportMarkdown" text, "improveOfReportId" uuid, "improveStatus" character varying, "improveMeta" jsonb, "endedAt" TIMESTAMP, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_test_reports_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_reports_run_id" ON "roleplay_test_reports" ("runId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_reports_spec_id" ON "roleplay_test_reports" ("specId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_test_reports_improve_of_report_id" ON "roleplay_test_reports" ("improveOfReportId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_roleplay_test_reports_run_case" ON "roleplay_test_reports" ("runId", "agentTestCaseId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_test_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roleplay_test_runs"`);
  }
}
