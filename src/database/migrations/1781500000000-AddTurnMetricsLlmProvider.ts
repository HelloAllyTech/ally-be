import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an explicit `llmProvider` dimension to turn metrics so drift analytics
 * can slice by provider (openai / gemini / anthropic) without inferring it from
 * the model string. Generation params (temperature / top_p / max_tokens) are
 * carried in the existing `metadata` jsonb, so no column is needed for those.
 *
 * Nullable + no backfill: existing rows have no recorded provider (it was never
 * captured), and there is no reliable way to reconstruct it — leave NULL.
 */
export class AddTurnMetricsLlmProvider1781500000000 implements MigrationInterface {
  name = 'AddTurnMetricsLlmProvider1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "llmProvider" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "llmProvider"`,
    );
  }
}
