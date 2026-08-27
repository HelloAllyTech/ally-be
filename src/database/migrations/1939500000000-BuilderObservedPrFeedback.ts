import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens `CHK_builder_pr_feedback_status` to accept `observed`.
 *
 * `observed` is a CI failure Builder recorded on a head commit it did not
 * author — see BuilderPrFeedbackStatus. It exists so the row can be written
 * (the timeline and the outcome flywheel both want it) while being invisible
 * to `countPending`, which is what decides whether a fix run goes out.
 *
 * A separate migration rather than an edit to BuilderPrFeedback1939200000000,
 * even though that one is not merged yet: it has already run on local
 * databases, so editing it in place would leave every developer's CHECK
 * constraint silently narrower than the enum their code believes in — and the
 * failure lands as a 23514 on an INSERT during a reconcile tick, a long way
 * from the cause.
 *
 * No backfill. Every existing row predates the guard, so `pending` is the
 * right answer for all of them.
 */
export class BuilderObservedPrFeedback1939500000000 implements MigrationInterface {
  name = 'BuilderObservedPrFeedback1939500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         DROP CONSTRAINT IF EXISTS "CHK_builder_pr_feedback_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         ADD CONSTRAINT "CHK_builder_pr_feedback_status" CHECK ("status" IN (
           'pending', 'in_fix', 'addressed', 'dismissed', 'stale', 'observed'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The rows have to go before the narrower CHECK can hold again.
    await queryRunner.query(
      `DELETE FROM "builder_pr_feedback" WHERE "status" = 'observed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         DROP CONSTRAINT IF EXISTS "CHK_builder_pr_feedback_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pr_feedback"
         ADD CONSTRAINT "CHK_builder_pr_feedback_status" CHECK ("status" IN (
           'pending', 'in_fix', 'addressed', 'dismissed', 'stale'
         ))`,
    );
  }
}
