import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `copilot_runs` table. The Agent Builder Copilot V1 agentic
 * server-loop (src/copilot) that owned this table has been removed; the current
 * Agent Builder Copilot is a stateless client-orchestrated per-field generator
 * (POST /learn/v1/agent-builder/generate-field) that persists nothing here.
 *
 * `down()` fully recreates the table (mirroring AddCopilotRunsTable1783000000000
 * + AddCopilotProgressLog1784000000000) so the migration is reversible, though
 * the orchestrator code that reads/writes it no longer exists.
 */
export class DropCopilotRunsTable1808000000000 implements MigrationInterface {
  name = 'DropCopilotRunsTable1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_parent_run_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_current_report_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_created_by"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "copilot_runs"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "copilot_runs" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"status" character varying NOT NULL DEFAULT 'STARTED', ` +
        `"brief" text NOT NULL, ` +
        `"config" jsonb NOT NULL, ` +
        `"draftScenarioId" integer, ` +
        `"round" integer NOT NULL DEFAULT 0, ` +
        `"bestScore" integer, ` +
        `"bestFieldValues" jsonb, ` +
        `"currentReportId" uuid, ` +
        `"roundHistory" jsonb, ` +
        `"fieldValues" jsonb, ` +
        `"errorMessage" text, ` +
        `"deletedAt" TIMESTAMP, ` +
        `"createdBy" integer NOT NULL, ` +
        `"updatedBy" integer NOT NULL, ` +
        `"endedAt" TIMESTAMP, ` +
        `"progressLog" jsonb NOT NULL DEFAULT '[]'::jsonb, ` +
        `"progressSeq" integer NOT NULL DEFAULT 0, ` +
        `"parentRunId" uuid, ` +
        `CONSTRAINT "PK_copilot_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_created_by" ON "copilot_runs" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_current_report_id" ON "copilot_runs" ("currentReportId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_parent_run_id" ON "copilot_runs" ("parentRunId") WHERE "deletedAt" IS NULL`,
    );
  }
}
