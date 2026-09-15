import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder reviews its own pull requests.
 *
 * Three columns, all additive and all defaulted, so an ally-be that has not
 * shipped the feature yet reads them as "never reviewed, review off".
 *
 * `autoReviewEnabled` defaults to false for the same reason `autoFixEnabled`
 * does: autonomy on somebody's open pull request is opt-in. It is the safer of
 * the two — a review run writes findings and touches no branch — but the
 * default still belongs to the admin, not to this migration.
 */
export class AddBuilderReview1970300000000 implements MigrationInterface {
  name = 'AddBuilderReview1970300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "reviewRunCount" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "reviewedSha" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "autoReviewEnabled" boolean NOT NULL DEFAULT false`,
    );

    // `currentStage` is a varchar with a CHECK, so a new stage is not free:
    // without this, the runner's first `post_stage REVIEWING` fails the
    // constraint and the review run dies on its opening call.
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_stage"
         CHECK ("currentStage" IS NULL OR "currentStage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'GATE', 'VERIFYING',
           'REVIEWING', 'REMEDIATING', 'FINALISING', 'E2E_VERIFY',
           'OPENING_PRS', 'REPORTING', 'DONE'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any session parked in REVIEWING would fail the narrower CHECK on the way
    // back down, so clear it first — the same move 1939000000000 makes for the
    // stages it removes.
    await queryRunner.query(
      `UPDATE "builder_sessions" SET "currentStage" = NULL WHERE "currentStage" = 'REVIEWING'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_stage"
         CHECK ("currentStage" IS NULL OR "currentStage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'GATE', 'VERIFYING',
           'REMEDIATING', 'FINALISING', 'E2E_VERIFY', 'OPENING_PRS',
           'REPORTING', 'DONE'
         ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "autoReviewEnabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "reviewedSha"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "reviewRunCount"`,
    );
  }
}
