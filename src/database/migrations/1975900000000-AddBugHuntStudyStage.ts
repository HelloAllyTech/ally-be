import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A `study` event stage: a fix session's study of the feature, posted before
 * it changes any code (see BugFixStudy). Same mechanics as every stage added
 * since 1951000000000 — the CHECK-constrained `bug_hunt_events.stage` column
 * must list every enum value or the first write of the new stage fails at
 * runtime with a generic 500.
 */
export class AddBugHuntStudyStage1975900000000 implements MigrationInterface {
  name = 'AddBugHuntStudyStage1975900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ADD CONSTRAINT "CHK_bug_hunt_events_stage"
      CHECK ("stage" IN (
        'skipped_disabled', 'skipped_quiet', 'finder_result', 'verify', 'study', 'fix_attempt',
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
      ALTER TABLE "bug_hunt_events"
      DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ADD CONSTRAINT "CHK_bug_hunt_events_stage"
      CHECK ("stage" IN (
        'skipped_disabled', 'skipped_quiet', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed', 'session_dispatched', 'release_dispatched',
        'released', 'release_failed', 'plan_created', 'step_started',
        'cancelled', 'description_edited', 'stage_changed',
        'decision_recorded', 'regressed', 'recurrence_suppressed', 'reversed'
      ))
    `);
  }
}
