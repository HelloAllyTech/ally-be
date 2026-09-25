import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Room for the notification that says the GitHub credential is being rejected.
 *
 * Adding a value to `BuilderNotificationKind` without widening this CHECK is
 * how every Slack message went missing for a week: the enum grew, the INSERT
 * threw, and the failure surfaced as silence. The migration guard that reads
 * every enum-backed column in this module exists because of that, and it fails
 * without this.
 *
 * Which would be a particularly poor way to lose this one, since its whole
 * purpose is to make a silent failure audible.
 */
export class BuilderCredentialNotification1971400000000 implements MigrationInterface {
  name = 'BuilderCredentialNotification1971400000000';

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
           'automation_paused', 'credential_rejected'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  }
}
