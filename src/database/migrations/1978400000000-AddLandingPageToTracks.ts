import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores a course's story-led landing page.
 *
 * `landingPage` is the whole config in one jsonb value — hook, persona, first
 * move, story arc, outcomes, cast and the per-block switches — normalised by
 * `normaliseTrackLandingPage` before it is written. NULL = the author never set
 * one up, which is every existing course: with no hook the public link renders
 * the classic outline exactly as before, so nothing changes for a course until
 * its author opts in.
 *
 * Nullable with no default and no CHECK. The shape is enforced in code on the
 * way in, and the public payload is built defensively on the way out, so a
 * constraint would only add a way for an old row to fail a migration.
 */
export class AddLandingPageToTracks1978400000000 implements MigrationInterface {
  name = 'AddLandingPageToTracks1978400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "landingPage" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "landingPage"`,
    );
  }
}
