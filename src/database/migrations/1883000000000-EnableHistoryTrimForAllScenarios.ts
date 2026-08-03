import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches on "Trim History" (historyTrimEnabled) for every existing scenario.
 * The toggle already defaults to true for newly-created/edited scenarios
 * (ally-web's createSimulation.ts falls back to `?? true` when the field is
 * absent), but that fallback only applies when a scenario is next saved
 * through Studio — it does not touch scenarios sitting untouched in the DB,
 * nor ones an admin previously explicitly turned off. This is a follow-up to
 * migration 1797000000000 (EnableComfortAudioTrimHistoryInterimReply), which
 * backfilled the same three toggles once; any scenario created or explicitly
 * toggled off since then would have drifted back to false/absent.
 *
 * Stored on scenarios.metadata (JSONB); the || merge operator overwrites only
 * historyTrimEnabled and leaves every other metadata field intact. Scenarios
 * with a NULL metadata column are skipped (should not exist in practice, but
 * guarded defensively).
 *
 * down() restores to false — same caveat as 1797000000000: a scenario that
 * had an explicit false before this migration also reads false after a
 * rollback, which is equivalent to the pre-migration state for that row.
 */
export class EnableHistoryTrimForAllScenarios1883000000000 implements MigrationInterface {
  name = 'EnableHistoryTrimForAllScenarios1883000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"historyTrimEnabled":true}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"historyTrimEnabled":false}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }
}
