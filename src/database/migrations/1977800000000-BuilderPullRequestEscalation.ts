import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A pull request automation handed to a person: when, why, how it ended, and
 * the review history the decision is made from. Plus the notification that
 * says so (`pr_needs_human`).
 */
export class BuilderPullRequestEscalation1977800000000 implements MigrationInterface {
  name = 'BuilderPullRequestEscalation1977800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         ADD COLUMN IF NOT EXISTS "needsHumanAt" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "needsHumanReason" text,
         ADD COLUMN IF NOT EXISTS "escalationResolution" character varying(20),
         ADD COLUMN IF NOT EXISTS "escalationResolvedAt" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "reviewHistory" jsonb`,
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
           'pr_merged_automatically', 'pr_needs_human'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_notifications" DROP CONSTRAINT IF EXISTS "CHK_builder_notifications_kind"`,
    );
    await queryRunner.query(
      `DELETE FROM "builder_notifications" WHERE "kind" = 'pr_needs_human'`,
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
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         DROP COLUMN IF EXISTS "reviewHistory",
         DROP COLUMN IF EXISTS "escalationResolvedAt",
         DROP COLUMN IF EXISTS "escalationResolution",
         DROP COLUMN IF EXISTS "needsHumanReason",
         DROP COLUMN IF EXISTS "needsHumanAt"`,
    );
  }
}
