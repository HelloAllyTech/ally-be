import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records WHY a bug was declined, so the decision can be counted and fed back.
 *
 * ## What was missing
 *
 * `BugFindingService.reject` stored `decided_by` and `decided_at` and nothing
 * else, and the Verify phase's dismissals stored not even that. Two
 * consequences, both visible in production:
 *
 *  1. **The sweep argued with the reviewer, nightly.** Dedup matches open rows
 *     only (see `BugFindingRepository.findOpenByDedupeKey`), so a finding
 *     someone rejected reappeared as a fresh row the next time a sweep read
 *     the same code. With no stored reason there was also nothing to tell the
 *     next sweep it had already been wrong about this. The sibling
 *     `src/ux-signals` module has always passed rejected items into its
 *     triage prompt as "do not re-propose"; the code sweep never did.
 *  2. **Precision was unmeasurable.** The tab could report what Bug Hunter
 *     cost and how many shifts finished clean, but not how often it was right
 *     — and "how often is it right" is the question that decides whether it
 *     may fix things unattended.
 *
 * ## Why a CHECK-constrained varchar and not free text alone
 *
 * A reason has to be countable to answer (2) and generalisable to help (1).
 * The taxonomy separates the two things a decline can mean: the finder was
 * WRONG (`not_a_bug`, `wrong_repo`, `duplicate`) versus the finding was right
 * and unwanted (`wont_fix`, `too_risky`). Only the first group counts against
 * accuracy or gets shown back to the sweep — a `wont_fix` re-filed next
 * quarter may well be correct, because priorities move. `decision_note` keeps
 * the free text alongside, optional so that mandatory prose never pushes
 * anyone into whichever enum value needs least typing.
 *
 * Nullable with no backfill: every existing declined row genuinely has no
 * recorded reason, and inventing `other` for them would put fabricated data
 * into the denominator of the accuracy metric this column exists to compute.
 * `BugHunterMetricsService` reports those rows as "reason not recorded"
 * instead.
 *
 * Hand-written, like every migration on this table — it carries CHECK
 * constraints TypeORM cannot express, and `migration:generate` would propose
 * dropping them. Never generate against `bug_findings`.
 */
export class AddBugFindingDecisionReason1951000000000 implements MigrationInterface {
  name = 'AddBugFindingDecisionReason1951000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      ADD COLUMN IF NOT EXISTS "decision_reason" character varying(20),
      ADD COLUMN IF NOT EXISTS "decision_note" text
    `);

    // Dropped first so a re-run after a partial apply doesn't fail on an
    // existing constraint — the same defensive shape as the ADD COLUMN above.
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      DROP CONSTRAINT IF EXISTS "CHK_bug_findings_decision_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      ADD CONSTRAINT "CHK_bug_findings_decision_reason"
      CHECK (
        "decision_reason" IS NULL OR "decision_reason" IN (
          'not_a_bug', 'duplicate', 'wrong_repo', 'wont_fix', 'too_risky', 'other'
        )
      )
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."decision_reason" IS
      'Why this bug was declined. not_a_bug/wrong_repo/duplicate mean the finder was wrong and count against precision; wont_fix/too_risky mean it was right and unwanted. Null = declined before this column existed, or not declined.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."decision_note" IS
      'Optional free text alongside decision_reason, in the decider''s own words.'
    `);

    // The metrics endpoint aggregates by (source, repo) over a date window,
    // and the sweep prompt reads the newest declines for one repo. Both scan
    // by decision date, which no existing index covers — `idx_bug_findings_created_at`
    // orders by discovery, and a bug found in July can be declined today.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_bug_findings_decided_at"
      ON "bug_findings" ("decided_at" DESC)
      WHERE "decided_at" IS NOT NULL
    `);

    // Three new event stages ride along in this migration rather than a
    // separate one, because they exist only to record what the columns above
    // capture: the decline and its reason, a shipped fix coming back, and a
    // re-find that dedupe suppressed. `bug_hunt_events.stage` is a
    // CHECK-constrained varchar, so appending an enum value in TypeScript
    // alone would make every write of one fail at runtime with a constraint
    // violation — the whole list has to be restated.
    //
    // The column is widened FIRST, and that is not housekeeping: it was
    // `character varying(20)`, and `recurrence_suppressed` is 21 characters.
    // Extending only the CHECK left a value the constraint permitted and the
    // type refused, so every suppressed re-find would have failed at run time
    // with `value too long for type character varying(20)` — caught by
    // applying this against the real table rather than by any test. 20 was
    // already tight (`release_dispatched` and `description_edited` are 18), so
    // the fix is the column rather than a cramped name for the value.
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ALTER COLUMN "stage" TYPE character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ADD CONSTRAINT "CHK_bug_hunt_events_stage"
      CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed', 'session_dispatched', 'release_dispatched',
        'released', 'release_failed', 'plan_created', 'step_started',
        'cancelled', 'description_edited', 'stage_changed',
        'decision_recorded', 'regressed', 'recurrence_suppressed'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any event already written under one of the three new stages would
    // violate the narrowed constraint, so they go first. Deleting them is
    // correct rather than lossy: each one only annotates a column this same
    // `down` is about to drop.
    await queryRunner.query(`
      DELETE FROM "bug_hunt_events"
      WHERE "stage" IN ('decision_recorded', 'regressed', 'recurrence_suppressed')
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ADD CONSTRAINT "CHK_bug_hunt_events_stage"
      CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed', 'session_dispatched', 'release_dispatched',
        'released', 'release_failed', 'plan_created', 'step_started',
        'cancelled', 'description_edited', 'stage_changed'
      ))
    `);
    // Back to 20 only once the over-long values are gone, or the narrowing
    // fails on its own data.
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ALTER COLUMN "stage" TYPE character varying(20)
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_bug_findings_decided_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT IF EXISTS "CHK_bug_findings_decision_reason"`,
    );
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      DROP COLUMN IF EXISTS "decision_note",
      DROP COLUMN IF EXISTS "decision_reason"
    `);
  }
}
