import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI Lab runs log: one row per skill execution. A multi-skill run produces
 * several rows (optionally sharing `batch_id`). Columns snapshot the skill
 * name, resolved prompt and variable values so a row survives later edits or
 * deletion of the source skill/variables (no FK to `lab_skills`).
 */
export class CreateLabRunsTable1845000000000 implements MigrationInterface {
  name = 'CreateLabRunsTable1845000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "lab_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "batch_id" uuid,
        "skill_id" uuid,
        "skill_name" text NOT NULL,
        "resolved_prompt" text NOT NULL,
        "variable_values" jsonb NOT NULL DEFAULT '[]',
        "model" character varying(100) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'RUNNING',
        "output" text,
        "error" text,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_runs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_runs_batch_id" ON "lab_runs" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_lab_runs_created_at" ON "lab_runs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_lab_runs_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_lab_runs_batch_id"`);
    await queryRunner.query(`DROP TABLE "lab_runs"`);
  }
}
