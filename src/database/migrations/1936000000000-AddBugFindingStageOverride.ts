import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bugs no longer appear on the product roadmap board — Bug Hunter's findings
 * table is the only place a bug is listed. So the coarse New → Prioritised →
 * In development → Released stage that a reader is used to seeing on the board
 * has to be readable on a finding instead.
 *
 * That stage is DERIVED from `status` (see bug-finding-stage.util.ts) and is
 * therefore not stored. What IS stored is the exception: a hand-set stage that
 * pins the row, for a bug fixed outside Bug Hunter entirely (a hand-written PR,
 * a config change, a fix that rode along with unrelated work) where the
 * pipeline's own status never moved and only a human can say what happened.
 *
 * Nullable and never backfilled: null means "derive it", which is what every
 * existing row wants.
 *
 * The CHECK constraint mirrors RoadmapOpportunityStage. `character varying` +
 * CHECK rather than a Postgres enum, per the convention this table already
 * follows — see migration 1898000000000, which owns the rest of them.
 *
 * `bug_hunt_events.stage` also gains `'stage_changed'`, so a hand-set stage
 * shows up in the drawer's per-finding timeline rather than silently differing
 * from what the pipeline would have said. Same pattern as `'description_edited'`
 * in migration 1916000000000; fits the existing `character varying(20)` at 13
 * chars.
 */
export class AddBugFindingStageOverride1936000000000 implements MigrationInterface {
  name = 'AddBugFindingStageOverride1936000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD COLUMN "stage_override" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD COLUMN "stage_overridden_by" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD COLUMN "stage_overridden_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
         ADD CONSTRAINT "CHK_bug_findings_stage_override"
         CHECK ("stage_override" IS NULL OR "stage_override" IN (
           'new', 'prioritised', 'under_development', 'released', 'archived'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started', 'cancelled', 'description_edited',
        'stage_changed'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    // These rows would violate the restored CHECK, and there is no nearest-
    // equivalent pipeline stage to remap them onto — a hand-set stage is not
    // something the pipeline ever did. Lossy in the same, bounded way migration
    // 1916000000000's rollback is: the timeline entries go, the stage itself is
    // dropped with the column below anyway.
    await queryRunner.query(
      `DELETE FROM "bug_hunt_events" WHERE "stage" = 'stage_changed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started', 'cancelled', 'description_edited'
      ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_stage_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP COLUMN "stage_overridden_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP COLUMN "stage_overridden_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP COLUMN "stage_override"`,
    );
  }
}
