import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two changes that go together, because they are two halves of "Bug Hunter
 * manages the whole fix and tells me about it here".
 *
 * 1. **Coordinated multi-repo fixes.** A fix session only ever has one repo
 *    checked out, so a bug spanning ally-be and ally-web previously stopped
 *    dead and handed the sequence back to a human. It now becomes a parent
 *    finding plus one ordered child per repo (`parent_finding_id`,
 *    `step_index`, `step_summary`), which Bug Hunter works through itself —
 *    one fix at a time, then one release at a time, in plan order. Two new
 *    statuses carry that: `blocked` (a child whose turn hasn't come) and
 *    `coordinating` (a parent working through its plan).
 *
 * 2. **`bug_hunter_notifications`.** Everything the module used to post to
 *    Slack — escalations, run summaries, release outcomes — now lands in an
 *    inbox inside the Bug Hunter tab instead. The three Slack methods on
 *    NotificationService are deleted in the same change; this table is where
 *    that traffic goes. It is NOT the platform `notifications` domain: those
 *    are addressed to an end user and drive email/push, whereas these are
 *    addressed to whoever is minding Bug Hunter and never leave the tab.
 *
 * Hand-written SQL, per the `bug_findings` precedent: the CHECK constraints
 * live here only — never run `migration:generate` against these tables.
 */
export class AddCoordinatedFixesAndNotifications1900000000000 implements MigrationInterface {
  name = 'AddCoordinatedFixesAndNotifications1900000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. findings: the ordered plan ────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        ADD COLUMN "parent_finding_id" uuid,
        ADD COLUMN "step_index" integer,
        ADD COLUMN "step_summary" text`,
    );
    // CASCADE, not SET NULL: an orphaned step of a deleted plan is meaningless
    // — it names a repo and an order with nothing to be ordered against.
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "FK_bug_findings_parent_finding_id"
        FOREIGN KEY ("parent_finding_id") REFERENCES "bug_findings" ("id") ON DELETE CASCADE`,
    );
    // The orchestrator's hot path is "given this parent, what is the next step"
    // — always read in plan order.
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_parent_step" ON "bug_findings" ("parent_finding_id", "step_index")`,
    );
    // One row per position in a plan. Without this, a retried plan write could
    // silently produce two "step 1"s and the orchestrator would pick one at
    // random.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bug_findings_parent_step" ON "bug_findings" ("parent_finding_id", "step_index")
        WHERE "parent_finding_id" IS NOT NULL`,
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

    // ── 2. events: the plan stage ────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
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

    // ── 3. the notification inbox ────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE "bug_hunter_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "finding_id" uuid,
        "run_id" uuid,
        "repo" text,
        "level" character varying(20) NOT NULL,
        "title" text NOT NULL,
        "body" text,
        "read_at" TIMESTAMP,
        "read_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunter_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunter_notifications_level"
          CHECK ("level" IN ('info', 'problem', 'action_needed')),
        CONSTRAINT "FK_bug_hunter_notifications_finding_id"
          FOREIGN KEY ("finding_id") REFERENCES "bug_findings" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_bug_hunter_notifications_run_id"
          FOREIGN KEY ("run_id") REFERENCES "bug_hunt_runs" ("id") ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunter_notifications_created_at" ON "bug_hunter_notifications" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunter_notifications_finding_id" ON "bug_hunter_notifications" ("finding_id")`,
    );
    // The badge count reads only unread rows, which stay a small minority of
    // the table — a partial index keeps that query cheap as the log grows.
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunter_notifications_read_at" ON "bug_hunter_notifications" ("read_at")
        WHERE "read_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bug_hunter_notifications"`);

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_hunt_events" WHERE "stage" IN ('plan_created', 'step_started')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed'
      ))`,
    );

    // Child steps are deleted rather than orphaned — see the FK note in up().
    // The parent survives as the bug it always was, back to needs_input so a
    // human picks the multi-repo sequence up by hand, which is what it did
    // before this migration.
    await queryRunner.query(
      `UPDATE "bug_findings" SET "status" = 'needs_input' WHERE "status" = 'coordinating'`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_findings" WHERE "parent_finding_id" IS NOT NULL`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."uq_bug_findings_parent_step"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_findings_parent_step"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "FK_bug_findings_parent_finding_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        DROP COLUMN "step_summary",
        DROP COLUMN "step_index",
        DROP COLUMN "parent_finding_id"`,
    );

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
  }
}
