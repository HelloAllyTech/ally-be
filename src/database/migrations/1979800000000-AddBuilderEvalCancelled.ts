import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Eval suites can be cancelled.
 *
 * A suite is dozens of full interview replays and costs real money; until now nothing could stop
 * one, so two duplicate baselines started minutes apart both ran to the end. `cancelled` joins the
 * suite and run status CHECKs: a cancelled suite keeps the runs that finished, its unstarted runs
 * are `cancelled`, and a cancelled prompt-gate suite never publishes.
 */
export class AddBuilderEvalCancelled1979800000000 implements MigrationInterface {
  name = 'AddBuilderEvalCancelled1979800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" DROP CONSTRAINT IF EXISTS "CHK_builder_eval_suites_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" ADD CONSTRAINT "CHK_builder_eval_suites_status"
        CHECK ("status" IN ('running', 'completed', 'errored', 'cancelled'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_eval_runs_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_runs" ADD CONSTRAINT "CHK_builder_eval_runs_status"
        CHECK ("status" IN ('queued', 'running', 'passed', 'failed', 'errored', 'cancelled'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "builder_eval_runs" SET "status" = 'errored' WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `UPDATE "builder_eval_suites" SET "status" = 'errored' WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_eval_runs_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_runs" ADD CONSTRAINT "CHK_builder_eval_runs_status"
        CHECK ("status" IN ('queued', 'running', 'passed', 'failed', 'errored'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" DROP CONSTRAINT IF EXISTS "CHK_builder_eval_suites_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_eval_suites" ADD CONSTRAINT "CHK_builder_eval_suites_status"
        CHECK ("status" IN ('running', 'completed', 'errored'))`,
    );
  }
}
