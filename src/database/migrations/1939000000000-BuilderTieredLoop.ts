import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder's tiered in-run loop: PLAN → CODE → GATE → VERIFY → REMEDIATE →
 * FINALISE.
 *
 * Three things change in the schema:
 *
 * 1. **Per-tier models.** A run now invokes a stronger model to plan and to
 *    review and a cheaper one to type, so the run row records which model ran
 *    which phase rather than carrying one `model` for everything.
 * 2. **New stages and event types.** `GATE`, `REMEDIATING` and `FINALISING`
 *    are posted by the runner itself at phase boundaries, so the phase rail
 *    reflects what actually ran instead of what the agent claimed. Builder's
 *    enums are varchar + CHECK (the bug_findings precedent), so widening one
 *    means rewriting its constraint.
 * 3. Nothing is dropped: `model` stays the coder tier and `defaultModel`
 *    stays a legacy fallback, so a run dispatched before this deploy still
 *    reads correctly.
 */
export class BuilderTieredLoop1939000000000 implements MigrationInterface {
  name = 'BuilderTieredLoop1939000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Per-tier models ────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD COLUMN IF NOT EXISTS "plannerModel" character varying(80),
         ADD COLUMN IF NOT EXISTS "verifierModel" character varying(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         ADD COLUMN IF NOT EXISTS "plannerModel" character varying(80),
         ADD COLUMN IF NOT EXISTS "coderModel" character varying(80),
         ADD COLUMN IF NOT EXISTS "verifierModel" character varying(80)`,
    );

    // ── Stages: + GATE, REMEDIATING, FINALISING ───────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_stage"
         CHECK ("currentStage" IS NULL OR "currentStage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'GATE', 'VERIFYING',
           'REMEDIATING', 'FINALISING', 'E2E_VERIFY', 'OPENING_PRS',
           'REPORTING', 'DONE'
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

    // ── Event types: + gate_result, phase_cost ────────────────────────────
    //
    // `gate_result` is the one event ally-be treats as evidence rather than
    // narration: /complete refuses a `done` without a passing one, so it has
    // to be a type the runner can post and the server can query for.
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows carrying the new values have to go before the old constraints can
    // hold again — a down migration that leaves the table unable to satisfy
    // its own CHECK is worse than one that loses telemetry.
    await queryRunner.query(
      `DELETE FROM "builder_build_events" WHERE "type" IN ('gate_result', 'phase_cost')`,
    );
    await queryRunner.query(
      `UPDATE "builder_build_events" SET "stage" = NULL
         WHERE "stage" IN ('GATE', 'REMEDIATING', 'FINALISING')`,
    );
    await queryRunner.query(
      `UPDATE "builder_sessions" SET "currentStage" = NULL
         WHERE "currentStage" IN ('GATE', 'REMEDIATING', 'FINALISING')`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_type"
         CHECK ("type" IN (
           'text', 'tool_call', 'tool_result', 'file_edit', 'todo',
           'test_output', 'stage_change', 'plan', 'verification', 'question',
           'e2e_evidence', 'e2e_skipped', 'pr_opened', 'report', 'cost',
           'error', 'done'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_events" DROP CONSTRAINT IF EXISTS "CHK_builder_build_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_events"
         ADD CONSTRAINT "CHK_builder_build_events_stage"
         CHECK ("stage" IS NULL OR "stage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'VERIFYING',
           'E2E_VERIFY', 'OPENING_PRS', 'REPORTING', 'DONE'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP CONSTRAINT IF EXISTS "CHK_builder_sessions_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD CONSTRAINT "CHK_builder_sessions_stage"
         CHECK ("currentStage" IS NULL OR "currentStage" IN (
           'SETUP', 'PLANNING', 'CODING', 'TESTING', 'VERIFYING',
           'E2E_VERIFY', 'OPENING_PRS', 'REPORTING', 'DONE'
         ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         DROP COLUMN IF EXISTS "plannerModel",
         DROP COLUMN IF EXISTS "coderModel",
         DROP COLUMN IF EXISTS "verifierModel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         DROP COLUMN IF EXISTS "plannerModel",
         DROP COLUMN IF EXISTS "verifierModel"`,
    );
  }
}
