import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Back-fills existing ROLEPLAY `track_items` whose `completionCriteria` was
 * left at the old accidental default of `{ minScore: 0 }`. The track-builder
 * UI used to pre-seed every new roleplay item with `minScore: 0`; the backend
 * (track-progress.service.ts `handleRoleplayEnd`) correctly treats an
 * *explicit* minScore as a real "score >= minScore" gate, so any learner
 * whose unbounded, signed running score ever went negative was permanently
 * unable to unlock the next item — even though the admin never intended to
 * configure a minimum. The UI default is now `{}` (see
 * ally-web CreateTrack.ts); this migration cleans up rows created before
 * that fix.
 *
 * Only removes the `minScore` key — leaves `minDurationSeconds` and any other
 * completionCriteria keys on the same row untouched. Also normalizes ROLEPLAY
 * rows where the whole `completionCriteria` column is still SQL NULL to '{}',
 * so every ROLEPLAY row consistently holds a JSON object. Idempotent (only
 * matches rows currently in one of those two stale states).
 */
export class BackfillRoleplayMinScoreDefault1890000000000 implements MigrationInterface {
  name = 'BackfillRoleplayMinScoreDefault1890000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = "completionCriteria" - 'minScore'
      WHERE "type" = 'ROLEPLAY'
        AND "completionCriteria" ->> 'minScore' = '0'
    `);

    await queryRunner.query(`
      UPDATE "track_items"
      SET "completionCriteria" = '{}'
      WHERE "type" = 'ROLEPLAY'
        AND "completionCriteria" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Intentional no-op: cannot distinguish a stripped accidental default of
    // 0 from a row that never had minScore set in the first place.
  }
}
