import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces `stt_configs` — a named registry of speech-to-text configurations,
 * the STT counterpart to `scenario_voices` — and points each language at one.
 *
 * Until now STT lived as a raw jsonb blob per language row, editable only as
 * hand-written JSON in the admin dashboard. That made "which engine do we use
 * for Kannada" un-referenceable: a simulation wanting to override it had to
 * restate the whole object, and changing a model meant editing every copy.
 *
 * Deliberately non-destructive. `languages.sttProviderConfig` is left in place
 * and still read as a fallback when `sttConfigId` is null, so this deploys
 * without a behaviour change and can be rolled back by ignoring the new column.
 * The old column is dropped in a later migration once nothing reads it.
 *
 * Seeding is derived from the data actually in the table rather than a
 * hardcoded list: every distinct (provider, config) pair already in use becomes
 * one registry row, and the languages using it are pointed at that row. A fresh
 * database with unseeded languages simply gets the platform default row.
 */
export class CreateSttConfigsRegistry1870000000000 implements MigrationInterface {
  name = 'CreateSttConfigsRegistry1870000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "stt_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "provider" character varying NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stt_configs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_stt_configs_name_idx" ON "stt_configs" ("name")`,
    );

    await queryRunner.query(
      `ALTER TABLE "languages" ADD "sttConfigId" uuid NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "languages"
      ADD CONSTRAINT "FK_languages_sttConfigId"
      FOREIGN KEY ("sttConfigId") REFERENCES "stt_configs"("id")
      ON DELETE SET NULL
    `);

    // One registry row per distinct config already in use. The name is derived
    // from provider + model (+ location, which is what distinguishes otherwise
    // identical Google entries), and de-duplicated by the unique index below —
    // hence the row_number suffix guard.
    await queryRunner.query(`
      INSERT INTO "stt_configs" ("name", "provider", "config")
      SELECT
        CASE WHEN cnt > 1 THEN base_name || ' (' || rn || ')' ELSE base_name END,
        provider,
        config
      FROM (
        SELECT
          d.provider,
          d.config,
          initcap(d.provider) || ' — ' || coalesce(d.config ->> 'model', 'default')
            || coalesce(' · ' || (d.config ->> 'location'), '')
            || coalesce(' · ' || (d.config ->> 'languageCode'), '') AS base_name,
          row_number() OVER (
            PARTITION BY initcap(d.provider) || ' — '
              || coalesce(d.config ->> 'model', 'default')
              || coalesce(' · ' || (d.config ->> 'location'), '')
              || coalesce(' · ' || (d.config ->> 'languageCode'), '')
            ORDER BY d.provider, d.config::text
          ) AS rn,
          count(*) OVER (
            PARTITION BY initcap(d.provider) || ' — '
              || coalesce(d.config ->> 'model', 'default')
              || coalesce(' · ' || (d.config ->> 'location'), '')
              || coalesce(' · ' || (d.config ->> 'languageCode'), '')
          ) AS cnt
        FROM (
          SELECT DISTINCT
            "sttProviderConfig" ->> 'provider' AS provider,
            coalesce("sttProviderConfig" -> 'config', '{}'::jsonb) AS config
          FROM "languages"
          WHERE "sttProviderConfig" ->> 'provider' IS NOT NULL
        ) d
      ) named
    `);

    // Point every language at the row matching the config it already had, so
    // resolution through the registry produces byte-identical metadata.
    await queryRunner.query(`
      UPDATE "languages" l
      SET "sttConfigId" = s.id
      FROM "stt_configs" s
      WHERE l."sttProviderConfig" ->> 'provider' = s.provider
        AND coalesce(l."sttProviderConfig" -> 'config', '{}'::jsonb) = s.config
        AND l."sttConfigId" IS NULL
    `);

    // A database whose languages were never seeded still needs something
    // selectable in the admin dropdown; this matches STT_LLM_PROVIDER_CONFIG.
    await queryRunner.query(`
      INSERT INTO "stt_configs" ("name", "provider", "config")
      SELECT 'Deepgram — nova-3', 'deepgram', '{"model": "nova-3"}'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM "stt_configs")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" DROP CONSTRAINT "FK_languages_sttConfigId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "languages" DROP COLUMN "sttConfigId"`,
    );
    await queryRunner.query(`DROP INDEX "uq_stt_configs_name_idx"`);
    await queryRunner.query(`DROP TABLE "stt_configs"`);
  }
}
