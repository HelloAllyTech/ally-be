import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ci_result`: the target repo's own CI verdict on an issue build's pull
 * request, recorded as a structured event (BuilderEventType.CI_RESULT).
 * Without it in the CHECK, recording one fails the PR tick's insert.
 */
export class BuilderEventTypeCiResult1976800000000 implements MigrationInterface {
  name = 'BuilderEventTypeCiResult1976800000000';

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
           'gate_result', 'ci_result', 'phase_cost', 'model_escalated',
           'budget_hold', 'question', 'e2e_evidence', 'e2e_skipped',
           'pr_opened', 'report', 'cost', 'error', 'done'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "builder_build_events" WHERE "type" = 'ci_result'`,
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
           'gate_result', 'phase_cost', 'model_escalated', 'budget_hold',
           'question', 'e2e_evidence', 'e2e_skipped', 'pr_opened', 'report',
           'cost', 'error', 'done'
         ))`,
    );
  }
}
