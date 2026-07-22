import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix Telugu's llmProviderConfig, which migration 1768392581395 back-filled
 * with `chirp_2` — a Google STT model, not an LLM (every other Indian language
 * got `gemini-2.0-flash-exp`). At runtime the Gemini client built with
 * model=chirp_2 fails and Telugu sessions silently fall back to the code
 * default openai/gpt-4o-mini.
 *
 * Idempotent and clobber-safe: only updates the row while it still equals the
 * buggy value verbatim, so manual dashboard edits are never overwritten.
 */
export class FixTeluguLlmProviderConfig1860000000000 implements MigrationInterface {
  name = 'FixTeluguLlmProviderConfig1860000000000';

  private readonly buggy = {
    provider: 'google',
    config: { model: 'chirp_2' },
  };

  private readonly fixed = {
    provider: 'google',
    config: { model: 'gemini-2.0-flash-exp' },
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "languages"
         SET "llmProviderConfig" = $1::jsonb
       WHERE "value" = 'te-IN'
         AND "llmProviderConfig" = $2::jsonb`,
      [JSON.stringify(this.fixed), JSON.stringify(this.buggy)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "languages"
         SET "llmProviderConfig" = $1::jsonb
       WHERE "value" = 'te-IN'
         AND "llmProviderConfig" = $2::jsonb`,
      [JSON.stringify(this.buggy), JSON.stringify(this.fixed)],
    );
  }
}
