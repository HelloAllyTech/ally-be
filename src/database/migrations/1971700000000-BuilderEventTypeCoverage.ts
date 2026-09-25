import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three values `BuilderEventType` / `BuilderStage` can produce that
 * `builder_build_events` has never accepted.
 *
 * Every insert carrying one fails with "violates check constraint", which the
 * exception filter turns into a 500 reading "Something went wrong on our side."
 * Nothing about the message says a column refused a value, so each of these
 * looked like a different bug:
 *
 *  - `budget_hold` — written by `raiseBudget` and by `recordBudgetHold`. The
 *    raise-budget dialog 500'd on every submission, so a build parked on its
 *    ceiling could not be released at all; and the runner's "I am holding"
 *    POST failed silently (it is telemetry, so it swallows its own errors),
 *    which meant `findActiveHold` never found a hold and the session page
 *    could not tell a run waiting for money from one that had simply stopped.
 *  - `model_escalated` — the escalation ladder's only announcement. A
 *    remediation round that moved to a stronger coder tier said so nowhere.
 *  - `REVIEWING` on the events' own stage CHECK. `AddBuilderReview` extended
 *    `CHK_builder_sessions_stage` and stopped there, so the runner's first
 *    `post_stage REVIEWING` took the WHOLE batch down with it — events are
 *    appended in one transaction, so nineteen good rows were lost with the one
 *    bad one.
 *
 * The guard that should have caught all three exists
 * (`check-constraints-cover-enums.spec.ts`) and listed four constraints out of
 * eighteen. It now lists every one.
 */
export class BuilderEventTypeCoverage1971700000000 implements MigrationInterface {
  name = 'BuilderEventTypeCoverage1971700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_type"
         CHECK ("type" IN (
           'text', 'tool_call', 'tool_result', 'file_edit', 'todo',
           'test_output', 'stage_change', 'plan', 'verification',
           'gate_result', 'phase_cost', 'model_escalated', 'budget_hold',
           'question', 'e2e_evidence', 'e2e_skipped', 'pr_opened', 'report',
           'cost', 'error', 'done'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_stage"
         CHECK ("stage" IS NULL OR "stage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'GATE', 'VERIFYING',
           'REVIEWING', 'REMEDIATING', 'FINALISING', 'E2E_VERIFY',
           'OPENING_PRS', 'REPORTING', 'DONE'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows carrying the new values have to go before the narrower constraints
    // can hold again — the same order `BuilderTieredLoop` used, and for the
    // same reason: a down migration that leaves the table unable to satisfy
    // its own CHECK is worse than one that loses telemetry.
    await queryRunner.query(
      `DELETE FROM "builder_build_events" WHERE "type" IN ('model_escalated', 'budget_hold')`,
    );
    await queryRunner.query(
      `UPDATE "builder_build_events" SET "stage" = NULL WHERE "stage" = 'REVIEWING'`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_type"
         CHECK ("type" IN (
           'text', 'tool_call', 'tool_result', 'file_edit', 'todo',
           'test_output', 'stage_change', 'plan', 'verification',
           'gate_result', 'phase_cost', 'question', 'e2e_evidence',
           'e2e_skipped', 'pr_opened', 'report', 'cost', 'error', 'done'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_stage"
         CHECK ("stage" IS NULL OR "stage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'GATE', 'VERIFYING',
           'REMEDIATING', 'FINALISING', 'E2E_VERIFY', 'OPENING_PRS',
           'REPORTING', 'DONE'
         ))`,
    );
  }
}
