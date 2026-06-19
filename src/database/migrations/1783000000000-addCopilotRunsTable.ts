import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCopilotRunsTable1783000000000 implements MigrationInterface {
  name = 'AddCopilotRunsTable1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
        `CONSTRAINT "PK_copilot_runs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_created_by" ON "copilot_runs" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_current_report_id" ON "copilot_runs" ("currentReportId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_current_report_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_created_by"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "copilot_runs"`);
  }
}
