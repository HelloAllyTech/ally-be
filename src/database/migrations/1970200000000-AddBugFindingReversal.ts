import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the columns `checkForAndRecordReversals` writes: a finding dismissed
 * as a finder error (`decision_reason` in `not_a_bug` / `wrong_repo` /
 * `duplicate`) that a later finding with the same `repo` + `dedupe_key`
 * proved wrong by actually shipping (MERGED or RELEASED).
 *
 * No new index: the lookup that populates these columns
 * (`findReversibleFinderErrors`) filters on `repo` + `dedupe_key`, already
 * covered by `idx_bug_findings_repo_dedupe_key`.
 *
 * No FK on `reversed_by_finding_id`, matching this table's other
 * self-reference (`parent_finding_id`) — see that column's comment.
 *
 * Hand-written, like every migration on this table — see
 * `1951000000000-AddBugFindingDecisionReason.ts`'s doc for why
 * `migration:generate` must never run against `bug_findings`.
 */
export class AddBugFindingReversal1970200000000 implements MigrationInterface {
  name = 'AddBugFindingReversal1970200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "reversed_by_finding_id" uuid
    `);

    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."reversed_at" IS
      'Set when this dismissal was proven wrong by a same-dedupe-key finding later shipping. Null = never dismissed, or dismissed and never contradicted.'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."reversed_by_finding_id" IS
      'The finding that proved this dismissal wrong by shipping. No FK, per this table''s convention for self-references.'
    `);

    // A `reversed` event stage rides along, same reasoning as the three added
    // in 1951000000000: the CHECK-constrained `bug_hunt_events.stage` column
    // must list every enum value or a write of the new stage fails at runtime.
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
        'decision_recorded', 'regressed', 'recurrence_suppressed', 'reversed'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "bug_hunt_events" WHERE "stage" = 'reversed'
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
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      DROP COLUMN IF EXISTS "reversed_by_finding_id",
      DROP COLUMN IF EXISTS "reversed_at"
    `);
  }
}
