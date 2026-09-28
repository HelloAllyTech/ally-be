import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-label `llm_usage.provider` on historical Builder / Bug Hunter rows from
 * their model id.
 *
 * Both recorded the provider from the engine rather than the model: Builder
 * hardcoded 'anthropic' (so every opencode/Gemini run read as Claude spend) and
 * Bug Hunter used the run's engine (so subagents on the other vendor were
 * mislabelled either way). Cost was always right — pricing resolves by model —
 * but every per-provider split was wrong. The writers now derive the provider
 * from the model; this fixes the rows written before that.
 *
 * Scoped to the two tasks that had the bug, and only to ids whose shape names
 * the provider, so nothing else in the table can change.
 */
export class FixCodingAgentLlmUsageProvider1973900000000 implements MigrationInterface {
  name = 'FixCodingAgentLlmUsageProvider1973900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "llm_usage" SET "provider" = 'gemini'
        WHERE "task" IN ('builder_build', 'bug_hunter')
          AND "provider" <> 'gemini'
          AND ("model" LIKE 'gemini-%' OR "model" LIKE 'models/gemini-%')`,
    );
    await queryRunner.query(
      `UPDATE "llm_usage" SET "provider" = 'anthropic'
        WHERE "task" IN ('builder_build', 'bug_hunter')
          AND "provider" <> 'anthropic'
          AND "model" LIKE 'claude-%'`,
    );
  }

  public async down(): Promise<void> {
    // No-op: the wrong labels are not worth restoring, and which rows had
    // which wrong value is not recoverable from the corrected table.
  }
}
