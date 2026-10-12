import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A `wrong_fix` event stage: a fix that turned out wrong, with the case-chain
 * link that broke (see BugWrongFix). Same mechanics as every stage added since
 * 1951000000000 — the CHECK-constrained `bug_hunt_events.stage` column must
 * list every enum value or the first write of the new stage fails at runtime.
 */
export class AddBugHuntWrongFixStage1976000000000 implements MigrationInterface {
  name = 'AddBugHuntWrongFixStage1976000000000';

  private readonly stages = [
    'skipped_disabled',
    'skipped_quiet',
    'finder_result',
    'verify',
    'study',
    'fix_attempt',
    'test_written',
    'doc_updated',
    'pr_opened',
    'merged',
    'escalated',
    'error',
    'settings_changed',
    'session_dispatched',
    'release_dispatched',
    'released',
    'release_failed',
    'plan_created',
    'step_started',
    'cancelled',
    'description_edited',
    'stage_changed',
    'decision_recorded',
    'regressed',
    'recurrence_suppressed',
    'reversed',
  ];

  private async constrain(
    queryRunner: QueryRunner,
    stages: string[],
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_events_stage"
    `);
    await queryRunner.query(`
      ALTER TABLE "bug_hunt_events"
      ADD CONSTRAINT "CHK_bug_hunt_events_stage"
      CHECK ("stage" IN (${stages.map((s) => `'${s}'`).join(', ')}))
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.constrain(queryRunner, [...this.stages, 'wrong_fix']);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.constrain(queryRunner, this.stages);
  }
}
