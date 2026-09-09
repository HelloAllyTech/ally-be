import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Characters go per-language: `voice_id`, `language_characteristics` and
 * `linguistic_style_samples` become jsonb maps keyed by `languages.id`.
 *
 * A character used to hold ONE voice, one style string and one flat list of
 * samples, while the simulation it gets applied to holds one of each PER
 * language. Selecting a character therefore filled exactly one slot and left
 * every other language tab empty — which also blocks publish, since an active
 * simulation needs a style sample for each language it voices.
 *
 * The backfill deliberately does not key the old values under English. The
 * character voice picker offers the whole catalog across languages, so a
 * character could be given a Marathi voice, and the applying code filed it
 * under English by convention — an English session dispatching Marathi TTS,
 * with nothing to catch it (validateLanguageVoices only checks a voice
 * exists, never that its language matches its slot). So each row is keyed
 * under its OWN voice's language, which repairs those rows on the way past.
 * Rows with no voice, or a voice whose language is unknown, fall back to
 * English — there is nothing better to infer from.
 */
export class CharacterVoicesPerLanguage1962000000000 implements MigrationInterface {
  name = 'CharacterVoicesPerLanguage1962000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN "voices" jsonb`,
    );

    // The language each row's content belongs to: its voice's language, else
    // English. Resolved once into a temp column so all three backfills agree
    // — deriving it three times could file a row's voice and its samples
    // under different languages.
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN "__lang_key" text`,
    );
    await queryRunner.query(`
      UPDATE "scenario_characters" c
      SET "__lang_key" = COALESCE(
        (
          SELECT v."languageId"::text
          FROM "scenario_voices" v
          WHERE v."id" = c."voice_id" AND v."languageId" IS NOT NULL
        ),
        (SELECT l."id"::text FROM "languages" l WHERE l."value" = 'en-IN' LIMIT 1),
        '1'
      )
    `);

    await queryRunner.query(`
      UPDATE "scenario_characters"
      SET "voices" = jsonb_build_object("__lang_key", "voice_id")
      WHERE "voice_id" IS NOT NULL
    `);

    // varchar -> jsonb object. USING runs per row, so the key comes from the
    // row's own resolved language.
    await queryRunner.query(`
      ALTER TABLE "scenario_characters"
      ALTER COLUMN "language_characteristics" TYPE jsonb
      USING CASE
        WHEN "language_characteristics" IS NULL THEN NULL
        ELSE jsonb_build_object("__lang_key", "language_characteristics")
      END
    `);

    // jsonb array -> jsonb object keyed by language. A row already holding an
    // object is left alone so a re-run cannot double-wrap it.
    await queryRunner.query(`
      UPDATE "scenario_characters"
      SET "linguistic_style_samples" =
        jsonb_build_object("__lang_key", "linguistic_style_samples")
      WHERE "linguistic_style_samples" IS NOT NULL
        AND jsonb_typeof("linguistic_style_samples") = 'array'
    `);

    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "__lang_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "voice_id"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN "voice_id" uuid`,
    );

    // Collapsing a map back to one value is lossy by nature: a character
    // voiced in three languages had no way to be expressed before this
    // migration. Prefer English, else whichever key sorts first, so the choice
    // is at least deterministic.
    //
    // The key is resolved into a column first because ALTER COLUMN ... USING
    // cannot contain a subquery ("cannot use subquery in transform
    // expression") — it may only reference the row's own columns.
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN "__lang_key" text`,
    );
    await queryRunner.query(`
      UPDATE "scenario_characters" c
      SET "__lang_key" = COALESCE(
        (
          SELECT l."id"::text FROM "languages" l
          WHERE l."value" = 'en-IN'
            AND c."voices" ? l."id"::text
          LIMIT 1
        ),
        (SELECT k FROM jsonb_object_keys(COALESCE(c."voices", '{}'::jsonb)) k ORDER BY k LIMIT 1),
        (SELECT l."id"::text FROM "languages" l WHERE l."value" = 'en-IN' LIMIT 1),
        '1'
      )
    `);

    await queryRunner.query(`
      UPDATE "scenario_characters"
      SET "voice_id" = ("voices" ->> "__lang_key")::uuid
      WHERE "voices" IS NOT NULL AND "voices" ? "__lang_key"
    `);

    await queryRunner.query(`
      UPDATE "scenario_characters"
      SET "linguistic_style_samples" = COALESCE(
        "linguistic_style_samples" -> "__lang_key",
        (
          SELECT value FROM jsonb_each("linguistic_style_samples")
          ORDER BY key LIMIT 1
        )
      )
      WHERE "linguistic_style_samples" IS NOT NULL
        AND jsonb_typeof("linguistic_style_samples") = 'object'
    `);

    await queryRunner.query(`
      ALTER TABLE "scenario_characters"
      ALTER COLUMN "language_characteristics" TYPE character varying(1000)
      USING LEFT("language_characteristics" ->> "__lang_key", 1000)
    `);

    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "__lang_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN "voices"`,
    );
  }
}
