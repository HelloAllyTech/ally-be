import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let Builder record the notifications it already sends.
 *
 * `builder_notifications.kind` allowed five values and the enum has grown to
 * nine. Every notification of a newer kind threw at the INSERT, which is why
 * the Slack channel stayed silent through a build that failed four runs:
 *
 *   fix_run_started      — since the fix loop was written
 *   release_failed       — added with the release watcher
 *   release_skipped      — added with the release watcher
 *   pr_ready_to_merge    — added with the Slack merge button
 *
 * `pr_ready_to_merge` is the worst of them. `considerMergePrompt` stamps
 * `mergePromptedAt` BEFORE notifying, so the throw left the pull request marked
 * as prompted for a message that was never sent, and it never retried. The
 * button existed, the endpoint worked, the approval was real, and the message
 * could not be written down.
 *
 * `agent_review` on builder_pr_feedback is the same omission in the same week;
 * the guard that now reads every enum-backed column in this module is the
 * answer to both.
 */
export class BuilderNotificationKinds1971000000000 implements MigrationInterface {
  name = 'BuilderNotificationKinds1971000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_notifications" DROP CONSTRAINT IF EXISTS "CHK_builder_notifications_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_notifications"
         ADD CONSTRAINT "CHK_builder_notifications_kind"
         CHECK ("kind" IN (
           'question_pending', 'build_completed', 'build_failed',
           'prs_opened', 'budget_reached', 'fix_run_started',
           'release_failed', 'release_skipped', 'pr_ready_to_merge',
           'automation_paused'
         ))`,
    );

    // A pull request marked as prompted for a message that never sent would
    // never be offered again. Clearing the stamp lets the next reconcile tick
    // post the button it was supposed to post.
    await queryRunner.query(
      `UPDATE "builder_pull_requests" pr
          SET "mergePromptedAt" = NULL
        WHERE pr."mergePromptedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "builder_notifications" n
             WHERE n."sessionId" = pr."sessionId"
               AND n."kind" = 'pr_ready_to_merge'
          )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "builder_notifications" WHERE "kind" IN (
         'fix_run_started', 'release_failed', 'release_skipped',
         'pr_ready_to_merge', 'automation_paused'
       )`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_notifications" DROP CONSTRAINT IF EXISTS "CHK_builder_notifications_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_notifications"
         ADD CONSTRAINT "CHK_builder_notifications_kind"
         CHECK ("kind" IN (
           'question_pending', 'build_completed', 'build_failed',
           'prs_opened', 'budget_reached'
         ))`,
    );
  }
}
