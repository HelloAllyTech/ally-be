import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates lab_auto_evaluations: automated (LLM-as-judge) scores for AI Lab
 * runs. Each row is one judge model scoring one run's output against a rubric.
 */
export class CreateLabAutoEvaluations1852000000000 implements MigrationInterface {
  name = 'CreateLabAutoEvaluations1852000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "lab_auto_evaluations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "model" character varying(100) NOT NULL,
        "criteria" text NOT NULL,
        "score" integer,
        "reasoning" text,
        "error" text,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lab_auto_evaluations_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_lab_auto_eval_run_id" ON "lab_auto_evaluations" ("run_id")`,
    );
    // Clean up an auto-eval when its run is deleted.
    await queryRunner.query(`
      ALTER TABLE "lab_auto_evaluations"
      ADD CONSTRAINT "fk_lab_auto_eval_run"
      FOREIGN KEY ("run_id") REFERENCES "lab_runs"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_auto_evaluations" DROP CONSTRAINT "fk_lab_auto_eval_run"`,
    );
    await queryRunner.query(`DROP INDEX "idx_lab_auto_eval_run_id"`);
    await queryRunner.query(`DROP TABLE "lab_auto_evaluations"`);
  }
}
