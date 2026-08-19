import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The manual kill switch for an on-demand fix session: "Stop fix session"
 * cancels the running GitHub Actions job (real compute/token savings, not
 * just a status flag — see `GithubActionsService.cancelRun`) and needs a
 * terminal status distinct from a plain `failed`, since a human stopping a
 * stuck session on purpose is a completely different thing for an admin to
 * read on the table than the fix agent giving up on its own — see
 * `BugFindingStatus.CANCELLED`'s doc.
 *
 * Two schema changes, both widening existing CHECK constraints — same
 * `bug_findings`/`bug_hunt_events` precedent as every prior Bug Hunter
 * migration; never run `migration:generate` against these tables:
 *
 * 1. `bug_findings.status` — new `'cancelled'` value.
 * 2. `bug_hunt_events.stage` — new `'cancelled'` value, so the drawer's
 *    per-finding timeline records who cancelled it and when.
 * 3. `bug_findings` — `session_run_id` (mirrors `release_run_id`: nullable
 *    even while queued/fixing, since `POST .../dispatches` returns 204 with
 *    no run id and the reconcile task resolves it afterwards — see
 *    `GithubActionsService`'s class doc), plus `cancelled_by`/`cancelled_at`
 *    (mirrors `released_by`/`released_at`) so the audit trail is a queryable
 *    column, not just a buried event payload.
 */
export class AddBugFindingCancellation1911000000000 implements MigrationInterface {
  name = 'AddBugFindingCancellation1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. findings: the cancelled status ────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_status" CHECK ("status" IN (
        'new', 'pending_approval', 'approved', 'queued', 'fixing', 'needs_input',
        'blocked', 'coordinating', 'pr_opened', 'merged', 'releasing', 'released',
        'release_failed', 'dismissed', 'rejected', 'failed', 'cancelled'
      ))`,
    );

    // ── 2. events: the cancelled stage ───────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started', 'cancelled'
      ))`,
    );

    // ── 3. findings: cancellation bookkeeping ────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        ADD COLUMN "session_run_id" bigint,
        ADD COLUMN "cancelled_by" integer,
        ADD COLUMN "cancelled_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        DROP COLUMN "cancelled_at",
        DROP COLUMN "cancelled_by",
        DROP COLUMN "session_run_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_hunt_events" WHERE "stage" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started'
      ))`,
    );

    // A cancelled row would violate the restored CHECK — map it back to the
    // nearest pre-existing meaning, same as a dispatched-but-unstarted session
    // reverting to approved in migration 1899000000000.
    await queryRunner.query(
      `UPDATE "bug_findings" SET "status" = 'approved' WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_status" CHECK ("status" IN (
        'new', 'pending_approval', 'approved', 'queued', 'fixing', 'needs_input',
        'blocked', 'coordinating', 'pr_opened', 'merged', 'releasing', 'released',
        'release_failed', 'dismissed', 'rejected', 'failed'
      ))`,
    );
  }
}
