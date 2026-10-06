import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets an author tag a course with the competencies it teaches.
 *
 * Until now nothing on a course named a competency: Analytics → Course impact
 * could only infer one from the course's roleplay items' scenario tags
 * (`track_items."scenarioId"` → `scenarios."competencyIds"`), so a course made
 * mostly of articles and quizzes was read on whatever its one roleplay happened
 * to assess. `competencyIds` makes the claim explicit; Course impact prefers it
 * when set and keeps the derived set as the fallback.
 *
 * Same storage as `scenarios."competencyIds"` (1843000000000): a nullable jsonb
 * array of `competencies.id` uuid strings, no foreign key (Postgres cannot
 * reference into a jsonb array; readers inner-join `competencies`, so an id
 * whose competency was deleted simply stops matching). NULL means "not tagged",
 * and the CHECK holds the one rule analytics depends on — the column is NULL or
 * a non-empty array of strings, so `[]` can never pass for "tagged with
 * nothing" and switch the fallback off. Shape only: the 15-id ceiling and the
 * uuid format are DTO rules (`TRACK_MAX_COMPETENCIES`), kept out of the
 * constraint so changing them is not a migration.
 *
 * The CHECK uses jsonpath (`@?`) rather than a subquery over
 * `jsonb_array_elements`, which Postgres rejects inside a CHECK. Each clause is
 * safe on a scalar, since Postgres does not short-circuit AND.
 *
 * No backfill: every existing course is untagged, which is exactly today's
 * behaviour (the derived set).
 */
export class AddCompetencyIdsToTracks1975730000000 implements MigrationInterface {
  name = 'AddCompetencyIdsToTracks1975730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "competencyIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" ADD CONSTRAINT "CHK_tracks_competency_ids_shape" CHECK ("competencyIds" IS NULL OR (jsonb_typeof("competencyIds") = 'array' AND "competencyIds" <> '[]'::jsonb AND NOT ("competencyIds" @? '$[*] ? (@.type() != "string")')))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP CONSTRAINT IF EXISTS "CHK_tracks_competency_ids_shape"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tracks" DROP COLUMN IF EXISTS "competencyIds"`,
    );
  }
}
