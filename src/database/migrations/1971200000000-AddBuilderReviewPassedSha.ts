import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separates "a review was dispatched for this commit" from "a review passed on
 * this commit".
 *
 * `reviewedSha` is stamped at DISPATCH, by design — reconcile needs to know a
 * review is already in flight for a head so it does not start a second one. It
 * says nothing about the outcome, and a review run that dispatches and then
 * fails leaves it stamped just the same.
 *
 * That was harmless while approval could only be reached from a review that had
 * just finished reporting zero findings. Moving approval onto the reconcile tick
 * quietly repurposed `reviewedSha` as evidence of a clean review, which it has
 * never been: ally-be#494 has three review runs, all failed, and a `reviewedSha`
 * that looks identical to a clean one.
 *
 * So the outcome gets its own column, written only where zero findings were
 * actually recorded.
 *
 * Existing approvals are backfilled from `approvedSha`: those were all made by
 * the old path, which required a genuinely clean review, so the fact is real
 * even though it was never written down.
 */
export class AddBuilderReviewPassedSha1971200000000 implements MigrationInterface {
  name = 'AddBuilderReviewPassedSha1971200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "reviewPassedSha" character varying(64)`,
    );
    await queryRunner.query(
      `UPDATE "builder_pull_requests" SET "reviewPassedSha" = "approvedSha" WHERE "approvedSha" IS NOT NULL AND "reviewPassedSha" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "reviewPassedSha"`,
    );
  }
}
