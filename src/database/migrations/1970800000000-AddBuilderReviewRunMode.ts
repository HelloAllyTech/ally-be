import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let a run be a review.
 *
 * `builder_build_runs.mode` is a varchar with a CHECK listing build | resume |
 * fix. The REVIEW mode was added to the TypeScript enum and the constraint was
 * not extended, so every review dispatch failed at the INSERT with
 * `violates check constraint "CHK_builder_build_runs_mode"` — and because
 * `dispatchReviewRun` stamps `reviewedSha` before dispatching, each pull
 * request was marked reviewed for a review that never ran.
 *
 * The identical omission bit `builder_sessions.currentStage` two days earlier
 * in the same feature. Two enums, two constraints, one of them missed: when a
 * TypeScript enum backs a varchar column here, assume there is a CHECK until
 * grep proves otherwise.
 */
export class AddBuilderReviewRunMode1970800000000 implements MigrationInterface {
  name = 'AddBuilderReviewRunMode1970800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume', 'fix', 'review'))`,
    );

    // Repair what the missing constraint left behind.
    //
    // `dispatchReviewRun` stamps `reviewedSha` and increments `reviewRunCount`
    // before dispatching, so a pull request whose dispatch then failed is
    // marked "already reviewed at this sha" for a review that never happened —
    // and would never be reviewed again until someone pushed to it.
    //
    // Scoped exactly to that case: a stamped review with no review run to show
    // for it. Because the constraint made `mode = 'review'` impossible to
    // insert, every such row is a casualty of this bug and no legitimate review
    // can be undone by this.
    await queryRunner.query(
      `UPDATE "builder_pull_requests" pr
          SET "reviewRunCount" = 0, "reviewedSha" = NULL
        WHERE pr."reviewRunCount" > 0
          AND NOT EXISTS (
            SELECT 1 FROM "builder_build_runs" r
             WHERE r."pullRequestId" = pr.id AND r."mode" = 'review'
          )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any review run would fail the narrower CHECK on the way back down.
    await queryRunner.query(
      `DELETE FROM "builder_build_runs" WHERE "mode" = 'review'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume', 'fix'))`,
    );
  }
}
