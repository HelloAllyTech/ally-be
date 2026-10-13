import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an author make a course's share link public.
 *
 * With `isPublicView` on, `/course/:id` on the learner app shows the course's
 * outline to anyone — logged in or not — and asks for a login only when they
 * press Start. It exposes the outline, never access: taking the course still
 * runs the organisation + group check in `assertTrackAvailable`.
 *
 * NOT NULL DEFAULT false, so every existing course is private — which is what
 * the request asked for ("off for all the past and upcoming courses"), and the
 * same as today's behaviour, where no course has a public link at all.
 */
export class AddPublicViewToTracks1976400000000 implements MigrationInterface {
  name = 'AddPublicViewToTracks1976400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "isPublicView" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "isPublicView"`,
    );
  }
}
