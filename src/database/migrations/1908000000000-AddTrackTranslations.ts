import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `track_translations` — per-language courses.
 *
 * One row per (course, language), created the moment a trainer selects the
 * language (status NOT_STARTED) and filled in by the translation job. Learners
 * are only ever served rows in status PUBLISHED.
 *
 * `content` holds one entry per translatable string, keyed by a stable-id path
 * into the course (`content.questions[q3].options[o1].text`), each carrying the
 * hash of the English it was translated from plus its `edited` / `reviewed` /
 * `scoring` flags. See track-translation-fields.util.ts.
 *
 * This supersedes the `translations` jsonb columns on `tracks`,
 * `track_sections` and `track_items`. Those columns are left in place rather
 * than dropped: `tracks.translations` holds title/description translations from
 * the previous attempt, and nothing ever populated the section/item ones. No
 * data is migrated across — the old path was never served to any client (no
 * client sent the `languageCode` query param it keyed off), so there is nothing
 * a learner can lose, and re-running translation regenerates it with the source
 * hashes and review state the new system needs.
 *
 * `track_enrollments.languageCode` persists the learner's per-course language
 * choice, so reading a course in Hindi does not mean switching the whole app to
 * Hindi. It is also the ONLY language grading trusts: a quiz submission is
 * marked against the accepted answers for the language stored here, never a
 * language named by the request.
 *
 * Loose-FK convention, matching the other track tables: bare columns + partial
 * indexes, no DB constraints.
 */
export class AddTrackTranslations1908000000000 implements MigrationInterface {
  name = 'AddTrackTranslations1908000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "track_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackId" uuid NOT NULL, "languageId" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'NOT_STARTED', "content" jsonb NOT NULL DEFAULT '{}', "publishedAt" TIMESTAMP, "lastJobId" character varying, "error" text, "requestedBy" integer, "publishedBy" integer, CONSTRAINT "PK_track_translations_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_track_translations_track_id_language_id_idx" ON "track_translations" ("trackId", "languageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_translations_track_id" ON "track_translations" ("trackId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "track_enrollments" ADD "languageCode" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "track_enrollments" DROP COLUMN "languageCode"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_translations_track_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_track_translations_track_id_language_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "track_translations"`);
  }
}
