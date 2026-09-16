import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let a review run record what it found.
 *
 * `builder_pr_feedback.kind` is a varchar with a CHECK listing ci_failure |
 * review_comment | review. `AGENT_REVIEW` was added to the TypeScript enum and
 * the constraint was not extended, so `recordReviewFindings` answered 500 on
 * every non-empty findings list — a review that found nothing approved happily,
 * and a review that found something died and lost its findings.
 *
 * That made the failure look like the review agent working: the one clean
 * review approved, and the one that had something to say failed with a database
 * error nobody would connect to a CHECK constraint.
 *
 * Third of its kind this week, after `builder_build_runs.mode` and
 * `builder_sessions.currentStage`. The guard added with the second one covered
 * two enums; it now covers every enum-backed column in this module, which is
 * the check that should have existed the first time.
 */
export class AddBuilderAgentReviewKind1970900000000 implements MigrationInterface {
  name = 'AddBuilderAgentReviewKind1970900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback" DROP CONSTRAINT IF EXISTS "CHK_builder_pr_feedback_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         ADD CONSTRAINT "CHK_builder_pr_feedback_kind"
         CHECK ("kind" IN ('ci_failure', 'review_comment', 'review', 'agent_review'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "builder_pr_feedback" WHERE "kind" = 'agent_review'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback" DROP CONSTRAINT IF EXISTS "CHK_builder_pr_feedback_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         ADD CONSTRAINT "CHK_builder_pr_feedback_kind"
         CHECK ("kind" IN ('ci_failure', 'review_comment', 'review'))`,
    );
  }
}
