import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidated episodic memory for Tracks: one evolving learner memory per
 * enrollment, folded from each conversation item's end-of-session memory
 * (TrackMemoryService). Shape:
 * { summary, items: { [trackItemId]: { sessionId, summary, updatedAt } },
 *   updatedAt }
 * `summary` is what the next track roleplay opens with (previousMemory);
 * `items` keeps the per-item source memories so a replayed item replaces its
 * own contribution instead of double-counting.
 */
export class AddMemoryToTrackEnrollments1886000000000 implements MigrationInterface {
  name = 'AddMemoryToTrackEnrollments1886000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" ADD COLUMN IF NOT EXISTS "memory" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" DROP COLUMN IF EXISTS "memory"`,
    );
  }
}
