import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets `bug_hunt_runs.trigger` hold 'pr_review' (OPP-0785): one read-only
 * run per open pull request head a person pushed, reviewing it while it is
 * open. Same shape as 1975840000000 and 1975850000000: the CHECK is
 * restated in full because a CHECK cannot be appended to.
 */
export class AddPrReviewRunTrigger1975890000000 implements MigrationInterface {
  name = 'AddPrReviewRunTrigger1975890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix', 'verify_findings', 'pr_review'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_hunt_runs" WHERE "trigger" = 'pr_review'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix', 'verify_findings'))`,
    );
  }
}
