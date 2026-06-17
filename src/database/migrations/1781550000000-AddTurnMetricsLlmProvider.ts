import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an explicit `llmProvider` dimension to turn metrics so drift analytics
 * can slice by provider (openai / gemini / anthropic) without inferring it from
 * the model string. (`llmModel` already exists from the create-table migration;
 * generation params live in the existing `metadata` jsonb.)
 *
 * Nullable + no backfill: existing rows have no recorded provider (it was never
 * captured) and there is no reliable way to reconstruct it — leave NULL.
 *
 * Idempotent (ADD COLUMN IF NOT EXISTS): some environments already have this
 * column from a parallel branch, so a plain ADD would collide. Timestamp is
 * 1781550000000 (not 1781500000000) to avoid colliding with the existing
 * migrations already at that timestamp.
 */
export class AddTurnMetricsLlmProvider1781550000000 implements MigrationInterface {
  name = 'AddTurnMetricsLlmProvider1781550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD COLUMN IF NOT EXISTS "llmProvider" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN IF EXISTS "llmProvider"`,
    );
  }
}
