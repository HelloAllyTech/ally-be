import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the on-demand **fix session** and the **release to production** step to
 * Bug Hunter, so an admin can take one known bug from the drawer all the way
 * to a live deploy without waiting for a nightly sweep.
 *
 * Four schema changes, all widening existing CHECK constraints rather than
 * adding tables — a fix session is deliberately just another `bug_hunt_runs`
 * row (one scoped to a single finding), not a parallel concept with its own
 * history table:
 *
 * 1. `bug_hunt_runs.trigger` — new `'fix_session'` value. The column is
 *    `varchar(10)` today and `'fix_session'` is 11 characters, so it is
 *    widened to `varchar(20)` to match `status` on the same table.
 * 2. `bug_hunt_events.stage` — four new values covering the dispatch/release
 *    lifecycle, so the drawer timeline reads continuously from "session
 *    dispatched" through to "released".
 * 3. `bug_findings.status` — `queued` (dispatch accepted, workflow not yet
 *    reported in), `releasing`, `released`, `release_failed`.
 * 4. `bug_findings` — the release bookkeeping columns. `release_run_id` is
 *    nullable even while `releasing`, because GitHub's
 *    `POST .../workflows/{file}/dispatches` returns 204 with no body: the run
 *    id is resolved afterwards by the reconcile task, and until it is, the
 *    dispatch timestamp is what identifies which run was ours.
 *
 * Hand-written SQL, per the `bug_hunter_settings`/`bug_findings` precedent:
 * these CHECK constraints live in migrations only — never run
 * `migration:generate` against these tables, it will propose dropping them.
 */
export class AddBugFixSessions1899000000000 implements MigrationInterface {
  name = 'AddBugFixSessions1899000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. runs: the fix_session trigger ─────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ALTER COLUMN "trigger" TYPE character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
        CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session'))`,
    );

    // ── 2. events: dispatch + release stages ─────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed'
      ))`,
    );

    // ── 3. findings: queued + the three release statuses ─────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_status" CHECK ("status" IN (
        'new', 'pending_approval', 'approved', 'queued', 'fixing', 'needs_input',
        'pr_opened', 'merged', 'releasing', 'released', 'release_failed',
        'dismissed', 'rejected', 'failed'
      ))`,
    );

    // ── 4. findings: release bookkeeping ─────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        ADD COLUMN "session_run_url" text,
        ADD COLUMN "release_tag" text,
        ADD COLUMN "release_run_id" bigint,
        ADD COLUMN "release_run_url" text,
        ADD COLUMN "released_by" integer,
        ADD COLUMN "released_at" TIMESTAMP,
        ADD COLUMN "dispatched_at" TIMESTAMP`,
    );

    // The reconcile task scans for findings stuck in 'releasing'. Partial
    // index because that set is tiny and short-lived next to the whole table.
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_releasing" ON "bug_findings" ("dispatched_at")
        WHERE "status" = 'releasing'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows sitting in one of the new statuses would violate the restored
    // CHECK, so map them back to the nearest pre-existing meaning first:
    // anything released or mid-release was, at minimum, merged; a queued
    // session had not started fixing yet, so it reverts to approved.
    await queryRunner.query(
      `UPDATE "bug_findings" SET "status" = 'merged'
        WHERE "status" IN ('releasing', 'released', 'release_failed')`,
    );
    await queryRunner.query(
      `UPDATE "bug_findings" SET "status" = 'approved' WHERE "status" = 'queued'`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_hunt_events" WHERE "stage" IN (
        'session_dispatched', 'release_dispatched', 'released', 'release_failed'
      )`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_hunt_runs" WHERE "trigger" = 'fix_session'`,
    );

    await queryRunner.query(`DROP INDEX "public"."idx_bug_findings_releasing"`);
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        DROP COLUMN "dispatched_at",
        DROP COLUMN "released_at",
        DROP COLUMN "released_by",
        DROP COLUMN "release_run_url",
        DROP COLUMN "release_run_id",
        DROP COLUMN "release_tag",
        DROP COLUMN "session_run_url"`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_status" CHECK ("status" IN (
        'new', 'pending_approval', 'approved', 'fixing', 'needs_input',
        'pr_opened', 'merged', 'dismissed', 'rejected', 'failed'
      ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed'
      ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ALTER COLUMN "trigger" TYPE character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
        CHECK ("trigger" IN ('scheduled', 'manual'))`,
    );
  }
}
