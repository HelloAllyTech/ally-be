import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces the comprehensive Bug Hunter findings table (`bug_findings`) and
 * the three-way kill switch (`bug_hunter_settings.mode`, replacing the plain
 * `enabled` boolean). Three things happen here:
 *
 * 1. `bug_findings` — one row per bug, from any source. Previously a hunt
 *    run's findings existed only as objects inside one workflow invocation
 *    (see `.claude/workflows/bug-hunt.mjs`) and were never persisted
 *    individually; only run-level aggregates (`bug_hunt_runs`) and a free-text
 *    transcript (`bug_hunt_events`) survived. This table is now the single
 *    place a bug — pipeline-found or human-reported — is tracked to a
 *    decision.
 * 2. `bug_hunter_settings.enabled` (boolean) → `mode` (varchar CHECK), a
 *    genuine three-way switch. `enabled=true` only ever meant today's
 *    original fully-automatic behaviour, so it backfills to `'ai'`;
 *    `enabled=false` backfills to `'off'`.
 * 3. `bug_hunt_events.finding_id` — lets the transcript (and the admin tab's
 *    per-finding drawer) show only the events about one specific finding,
 *    alongside the existing whole-run timeline.
 *
 * Also backfills every existing `analytics_suggestions` row with
 * `suggestedType='bug'` into `bug_findings` (source='analytics_suggestion') so
 * bug history isn't split across two screens — see the down() note on why
 * that backfill is one-way.
 *
 * Hand-written SQL, per the `bug_hunter_settings`/`analytics_suggestions`
 * precedent: the CHECK constraints and FKs live here only — never run
 * `migration:generate` against these tables.
 */
export class CreateBugFindings1898000000000 implements MigrationInterface {
  name = 'CreateBugFindings1898000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bug_findings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid,
        "repo" text,
        "source" character varying(20) NOT NULL,
        "title" text NOT NULL,
        "description" text NOT NULL,
        "file" text,
        "evidence" text,
        "severity" character varying(10),
        "proven" boolean NOT NULL DEFAULT false,
        "touches_guarded_path" boolean NOT NULL DEFAULT false,
        "reported_bug_id" uuid,
        "dedupe_key" text,
        "status" character varying(20) NOT NULL DEFAULT 'new',
        "pr_url" text,
        "escalation_question" text,
        "escalation_answer" text,
        "escalation_answered_by" integer,
        "escalation_answered_at" TIMESTAMP,
        "decided_by" integer,
        "decided_at" TIMESTAMP,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_findings_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_findings_source" CHECK ("source" IN (
          'test_failure', 'lint_error', 'code_review', 'production_log',
          'reported_bug', 'analytics_suggestion'
        )),
        CONSTRAINT "CHK_bug_findings_severity" CHECK ("severity" IS NULL OR "severity" IN ('low', 'medium', 'high')),
        CONSTRAINT "CHK_bug_findings_status" CHECK ("status" IN (
          'new', 'pending_approval', 'approved', 'fixing', 'needs_input',
          'pr_opened', 'merged', 'dismissed', 'rejected', 'failed'
        )),
        CONSTRAINT "FK_bug_findings_run_id"
          FOREIGN KEY ("run_id") REFERENCES "bug_hunt_runs" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_bug_findings_reported_bug_id"
          FOREIGN KEY ("reported_bug_id") REFERENCES "roadmap_opportunities" ("id")
          ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_status" ON "bug_findings" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_repo_dedupe_key" ON "bug_findings" ("repo", "dedupe_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_reported_bug_id" ON "bug_findings" ("reported_bug_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_findings_created_at" ON "bug_findings" ("createdAt" DESC)`,
    );

    // ── settings: enabled boolean → mode three-way switch ────────────────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ADD COLUMN "mode" character varying(10)`,
    );
    await queryRunner.query(
      `UPDATE "bug_hunter_settings" SET "mode" = CASE WHEN "enabled" THEN 'ai' ELSE 'off' END`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ALTER COLUMN "mode" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ALTER COLUMN "mode" SET DEFAULT 'off'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ADD CONSTRAINT "CHK_bug_hunter_settings_mode" CHECK ("mode" IN ('off', 'manual', 'ai'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" DROP COLUMN "enabled"`,
    );

    // ── events: link one event to the specific finding it's about ───────────
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD COLUMN "finding_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "FK_bug_hunt_events_finding_id"
        FOREIGN KEY ("finding_id") REFERENCES "bug_findings" ("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_events_finding_id" ON "bug_hunt_events" ("finding_id")`,
    );

    // ── backfill: old Analytics → Suggestions bug rows become findings ──────
    // PENDING/ACCEPTED suggestions are still-open bugs (an ACCEPTED one is
    // filed on the roadmap but not yet fixed) → status 'new', carrying the
    // filed opportunity forward as reported_bug_id. REJECTED → 'rejected'.
    await queryRunner.query(
      `INSERT INTO "bug_findings"
        ("source", "title", "description", "reported_bug_id", "status", "createdAt", "updatedAt")
       SELECT
        'analytics_suggestion',
        LEFT("title", 200),
        "body",
        "opportunity_id",
        CASE WHEN "status" = 'rejected' THEN 'rejected' ELSE 'new' END,
        "createdAt",
        "updatedAt"
       FROM "analytics_suggestions"
       WHERE "suggested_type" = 'bug'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The backfilled rows are deleted along with the table drop below — this
    // is a one-way migration for that data (rolling back does not restore
    // the Suggestions-tab view of them; they were never removed from
    // `analytics_suggestions` itself, so nothing is actually lost).
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_hunt_events_finding_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "FK_bug_hunt_events_finding_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP COLUMN "finding_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ADD COLUMN "enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `UPDATE "bug_hunter_settings" SET "enabled" = ("mode" = 'ai')`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" DROP CONSTRAINT "CHK_bug_hunter_settings_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" DROP COLUMN "mode"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_findings_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_findings_reported_bug_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_bug_findings_repo_dedupe_key"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_bug_findings_status"`);
    await queryRunner.query(`DROP TABLE "bug_findings"`);
  }
}
