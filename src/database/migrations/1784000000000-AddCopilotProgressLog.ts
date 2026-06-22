import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCopilotProgressLog1784000000000 implements MigrationInterface {
  name = 'AddCopilotProgressLog1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Append-only activity feed for the live chat UI. Default '[]' means every
    // existing row reads back as an empty feed (backward compatible).
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "progressLog" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    // Monotonic seq counter for progress events.
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "progressSeq" integer NOT NULL DEFAULT 0`,
    );
    // Audit chain across `/revise` turns.
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" ADD COLUMN IF NOT EXISTS "parentRunId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_copilot_runs_parent_run_id" ON "copilot_runs" ("parentRunId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_copilot_runs_parent_run_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" DROP COLUMN IF EXISTS "parentRunId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" DROP COLUMN IF EXISTS "progressSeq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "copilot_runs" DROP COLUMN IF EXISTS "progressLog"`,
    );
  }
}
