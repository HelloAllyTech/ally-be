import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `llm_usage.cachedTokens` only ever stored prompt-cache READ tokens (see
 * BugHunterRepoClassifierService, the one existing writer). Cache WRITE
 * tokens (Anthropic's `cache_creation_input_tokens`) were never captured
 * anywhere, so `computeCostUsd` had no way to price them — Bug Hunter's
 * "Est. cost" tile undercounted real spend for exactly this reason (cache
 * writes are billed at a premium over base input, and an agentic loop that
 * resends a growing transcript every turn generates a lot of them). This
 * column gives cache writes a place to land alongside the existing
 * cache-read column. Nullable, never backfilled: historical rows have no
 * cache breakdown behind them.
 */
export class AddLlmUsageCacheCreationTokens1935000000000 implements MigrationInterface {
  name = 'AddLlmUsageCacheCreationTokens1935000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_usage" ADD COLUMN "cacheCreationTokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_usage" DROP COLUMN "cacheCreationTokens"`,
    );
  }
}
