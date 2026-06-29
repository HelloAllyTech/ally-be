import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches on Comfort Audio, Trim History, and Interim Reply for all existing
 * scenarios. These three voice-pipeline toggles default to false (opt-in) in
 * the Studio form; this backfill sets them all to true so every pre-existing
 * roleplay gets the improved experience without requiring manual re-edits.
 *
 * All three are stored on scenarios.metadata (JSONB). The || merge operator
 * overwrites only the named keys and leaves every other metadata field intact.
 * Scenarios with a NULL metadata column are skipped (should not exist in
 * practice, but guarded defensively).
 *
 * down() restores them to false. Note: any scenario that had an explicit false
 * before this migration runs will also read false after a rollback, which is
 * equivalent to the pre-migration state.
 */
export class EnableComfortAudioTrimHistoryInterimReply1797000000000 implements MigrationInterface {
  name = 'EnableComfortAudioTrimHistoryInterimReply1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"comfortAudioEnabled":true,"historyTrimEnabled":true,"interimReplyEnabled":true}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" || '{"comfortAudioEnabled":false,"historyTrimEnabled":false,"interimReplyEnabled":false}'::jsonb
        WHERE "metadata" IS NOT NULL`,
    );
  }
}
