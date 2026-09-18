import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A scheduled sweep whose repo has no new commits since its last completed
 * sweep, and no CloudWatch log group to catch a production issue without
 * one, has nothing new for its finders to look at — see
 * `BugHunterService.requireWorthSweepingOrRecordSkip`. Mirrors
 * `skipped_disabled` exactly (same run-status/event-stage pairing, same "did
 * zero work" contract), so the run history and cost analytics can tell "off"
 * apart from "on, but a quiet night" without a special case.
 *
 * Hand-written SQL, per this table's own precedent (see
 * `AddBugFixSessions`'s doc comment) — never run `migration:generate` against
 * these two CHECK constraints.
 */
export class AddBugHuntSkippedQuiet1970300000000 implements MigrationInterface {
  name = 'AddBugHuntSkippedQuiet1970300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_status"
        CHECK ("status" IN ('running', 'completed', 'failed', 'skipped_disabled', 'skipped_quiet'))`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"`,
    );
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"`,
    );
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

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_status"
        CHECK ("status" IN ('running', 'completed', 'failed', 'skipped_disabled'))`,
    );
  }
}
