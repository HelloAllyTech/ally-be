import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which commit Builder approved.
 *
 * Approval used to happen in exactly one place: the moment a review run
 * recorded zero findings. That tied a *policy* ("approve clean reviews") to an
 * *event* ("a review just finished"), so a pull request reviewed clean while
 * `autoApproveEnabled` was off could never be approved afterwards — the review
 * cap stops a second review, and nothing else ever reconsiders. ally-web#658
 * sat in exactly that state: reviewed, clean, capped, unapprovable.
 *
 * Moving the decision onto the reconcile tick fixes that, but the approve call
 * posts a new review every time it runs, so it needs somewhere to record that
 * it already approved this commit. That is this column. Per-sha rather than a
 * boolean so a new push re-opens the question, which is the whole point of
 * approving a commit rather than a pull request.
 */
export class AddBuilderApprovedSha1971100000000 implements MigrationInterface {
  name = 'AddBuilderApprovedSha1971100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "approvedSha" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "approvedSha"`,
    );
  }
}
