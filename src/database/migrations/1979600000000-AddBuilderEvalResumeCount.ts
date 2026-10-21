import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eval suites survive a deploy.
 *
 * ## builder_eval_suites."resumeCount" — int, default 0
 *
 * A suite runs in one ally-be process and is hours of runs; a deploy replaces every task, and on
 * 2026-10-21 one cut off the first production baseline after 5 of 63 runs. A running suite now
 * heartbeats, and a process that finds one silent claims it (an atomic UPDATE that increments this
 * counter) and resumes its queued runs. The counter is what stops a suite that keeps killing its
 * own process from being resumed forever: past the limit it is marked errored instead.
 */
export class AddBuilderEvalResumeCount1979600000000 implements MigrationInterface {
  name = 'AddBuilderEvalResumeCount1979600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" ADD COLUMN IF NOT EXISTS "resumeCount" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" DROP COLUMN IF EXISTS "resumeCount"`,
    );
  }
}
