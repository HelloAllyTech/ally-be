import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * eval_experiments (FR13/FR16): a named, saved filter tuple over the
 * language-eval slice dimensions ({language, scenarioVersionId,
 * promptVersion, llmModel}). The row with isPinnedReference = true is THE
 * pinned reference experiment every dashboard comparison reads its deltas
 * against. An experiment is a saved filter set, not a new runtime concept —
 * sessions already carry all the dimensions.
 */
export class CreateEvalExperiments1829000000003 implements MigrationInterface {
  name = 'CreateEvalExperiments1829000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "eval_experiments" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"name" character varying NOT NULL, ` +
        `"filters" jsonb NOT NULL DEFAULT '{}', ` +
        `"isPinnedReference" boolean NOT NULL DEFAULT false, ` +
        `"createdBy" integer, ` +
        `CONSTRAINT "PK_eval_experiments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "eval_experiments_pinned_idx" ON "eval_experiments" ("isPinnedReference")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."eval_experiments_pinned_idx"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "eval_experiments"`);
  }
}
