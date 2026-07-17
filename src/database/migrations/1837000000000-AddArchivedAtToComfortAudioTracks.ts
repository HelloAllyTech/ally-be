import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an `archived_at` timestamp to comfort_audio_tracks. When set, the track
 * is hidden from the roleplay comfort-audio picker going forward but keeps
 * working for scenarios that already reference its URL (playback resolves by
 * URL, not by track id). Null = active; archiving is reversible.
 */
export class AddArchivedAtToComfortAudioTracks1837000000000 implements MigrationInterface {
  name = 'AddArchivedAtToComfortAudioTracks1837000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comfort_audio_tracks" ADD COLUMN "archived_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_comfort_audio_tracks_archived_at" ON "comfort_audio_tracks" ("archived_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_comfort_audio_tracks_archived_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comfort_audio_tracks" DROP COLUMN "archived_at"`,
    );
  }
}
