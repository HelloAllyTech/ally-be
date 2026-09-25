import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The last click: let Builder merge a pull request it reviewed clean.
 *
 * Two changes, and they have to land together. The column is the switch —
 * `false`, like every other autonomy switch here, because the value of this
 * one is that it can be turned back off without a deploy. The widened CHECK is
 * room for the notification that says it happened.
 *
 * The constraint is rewritten in full rather than extended, because that is
 * the only thing Postgres offers, and every existing value has to be carried
 * across. Forgetting one is how this module lost a week of Slack messages:
 * the enum grew, the INSERT threw, and the failure surfaced as silence.
 *
 * That would be an especially bad trade here. A machine merging to master and
 * dispatching a production release is the loudest event Builder has, and the
 * announcement is the only thing that makes it visible to anyone who was not
 * watching the admin page at the time.
 */
export class BuilderAutoMerge1973200000000 implements MigrationInterface {
  name = 'BuilderAutoMerge1973200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         ADD COLUMN IF NOT EXISTS "autoMergeEnabled" boolean NOT NULL DEFAULT false`,
    );

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
           'automation_paused', 'credential_rejected',
           'pr_merged_automatically'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The constraint narrows first. Dropping the column while rows of the new
    // kind are still insertable would leave the switch gone and the
    // notification it exists for still being written.
    await queryRunner.query(
      `ALTER TABLE "builder_notifications" DROP CONSTRAINT IF EXISTS "CHK_builder_notifications_kind"`,
    );
    await queryRunner.query(
      `DELETE FROM "builder_notifications" WHERE "kind" = 'pr_merged_automatically'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_notifications"
         ADD CONSTRAINT "CHK_builder_notifications_kind"
         CHECK ("kind" IN (
           'question_pending', 'build_completed', 'build_failed',
           'prs_opened', 'budget_reached', 'fix_run_started',
           'release_failed', 'release_skipped', 'pr_ready_to_merge',
           'automation_paused', 'credential_rejected'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "autoMergeEnabled"`,
    );
  }
}
