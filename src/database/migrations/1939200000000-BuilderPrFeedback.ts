import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The post-PR loop: Builder learns what happened to its own pull requests and
 * can act on it.
 *
 * Three parts:
 *
 * 1. **`builder_pr_feedback`** — failing checks and human review comments, one
 *    row each. A table of its own rather than reusing `builder_questions`,
 *    which is the nearest-looking thing: a question stops a run and waits for
 *    the session's owner, while feedback arrives while nothing is running, from
 *    someone else, and it is Builder that has to act. The unique
 *    `(pullRequestId, kind, externalId)` is load-bearing — this is polled, so
 *    every reconcile tick re-reads every comment and the write must be an
 *    upsert or the table would grow with the clock.
 * 2. **`builder_pull_requests`** gains `state`, `headSha`, `lastCheckedAt` and
 *    `fixRunCount`. `state` is what finally distinguishes a merged PR from one
 *    closed *without* merging — the same row before this migration, and the
 *    second is the most informative outcome Builder can have.
 * 3. **`fix` run mode** and the two settings that bound it. Autonomy on an open
 *    pull request is opt-in and capped: agreeing Builder may write code is not
 *    agreeing it may keep pushing to a branch a human is reviewing.
 */
export class BuilderPrFeedback1939200000000 implements MigrationInterface {
  name = 'BuilderPrFeedback1939200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Pull request state ────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         ADD COLUMN IF NOT EXISTS "state" character varying(20),
         ADD COLUMN IF NOT EXISTS "headSha" character varying(64),
         ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP,
         ADD COLUMN IF NOT EXISTS "fixRunCount" integer NOT NULL DEFAULT 0`,
    );
    // Existing rows have been reconciled for merge state all along, so their
    // state is inferable; leaving it NULL would have the new reconcile filter
    // treat a merged PR as never-read and poll it forever.
    await queryRunner.query(
      `UPDATE "builder_pull_requests"
          SET "state" = CASE WHEN "merged" THEN 'closed' ELSE 'open' END
        WHERE "state" IS NULL`,
    );

    // ── Fix runs ──────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD COLUMN IF NOT EXISTS "pullRequestId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume', 'fix'))`,
    );

    // ── Settings ──────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         ADD COLUMN IF NOT EXISTS "autoFixEnabled" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "maxFixRunsPerPr" integer NOT NULL DEFAULT 3`,
    );

    // ── Notifications: a new kind ─────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_notifications" DROP CONSTRAINT IF EXISTS "CHK_builder_notifications_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_notifications"
         ADD CONSTRAINT "CHK_builder_notifications_kind"
         CHECK ("kind" IN (
           'question_pending', 'build_completed', 'build_failed',
           'prs_opened', 'budget_reached', 'fix_run_started'
         ))`,
    );

    // ── The feedback table ────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_pr_feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "pullRequestId" uuid NOT NULL,
        "sessionId" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "externalId" character varying(200) NOT NULL,
        "author" character varying(120),
        "body" text,
        "path" text,
        "line" integer,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "fixRunId" uuid,
        "replyUrl" text,
        "addressedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_pr_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_pr_feedback_pr" FOREIGN KEY ("pullRequestId")
          REFERENCES "builder_pull_requests"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_builder_pr_feedback_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_pr_feedback_kind" CHECK ("kind" IN (
          'ci_failure', 'review_comment', 'review'
        )),
        CONSTRAINT "CHK_builder_pr_feedback_status" CHECK ("status" IN (
          'pending', 'in_fix', 'addressed', 'dismissed', 'stale'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_pr_feedback_pr"
         ON "builder_pr_feedback" ("pullRequestId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_pr_feedback_status"
         ON "builder_pr_feedback" ("status")`,
    );
    // The index the upsert relies on: feedback is polled, so the same comment
    // is seen on every tick and must collide rather than duplicate.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_pr_feedback_external"
         ON "builder_pr_feedback" ("pullRequestId", "kind", "externalId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_pr_feedback"`);

    await queryRunner.query(
      `DELETE FROM "builder_notifications" WHERE "kind" = 'fix_run_started'`,
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

    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         DROP COLUMN IF EXISTS "autoFixEnabled",
         DROP COLUMN IF EXISTS "maxFixRunsPerPr"`,
    );

    // Fix runs have to go before the mode CHECK can hold again.
    await queryRunner.query(
      `DELETE FROM "builder_build_runs" WHERE "mode" = 'fix'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "pullRequestId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests"
         DROP COLUMN IF EXISTS "state",
         DROP COLUMN IF EXISTS "headSha",
         DROP COLUMN IF EXISTS "lastCheckedAt",
         DROP COLUMN IF EXISTS "fixRunCount"`,
    );
  }
}
