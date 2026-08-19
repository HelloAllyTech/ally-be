import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The "My shift log" run-history table shows an estimated USD cost per run
 * (`total_token_cost_usd`) but not the raw token count that produced it.
 * `llm_usage` already carries per-model `promptTokens`/`completionTokens` for
 * every run (tagged `metadata.runId`), so `BugHunterService.snapshotUsage`
 * (renamed from `snapshotCostUsd`, same query) now sums both alongside cost
 * and stamps them here at the same close-time/record-actual-cost snapshot
 * points. Nullable, never backfilled: a run closed before this migration has
 * a cost snapshot with no token breakdown behind it.
 */
export class AddBugHuntRunTokenCounts1912000000000 implements MigrationInterface {
  name = 'AddBugHuntRunTokenCounts1912000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs"
        ADD COLUMN "total_input_tokens" integer,
        ADD COLUMN "total_output_tokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs"
        DROP COLUMN "total_output_tokens",
        DROP COLUMN "total_input_tokens"`,
    );
  }
}
