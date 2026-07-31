import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces `llm_configs` — the LLM twin of `stt_configs` (migration
 * 1870000000000) — and points each language at one.
 *
 * Same shape and same reasoning: LLM choice lived as a raw jsonb blob per
 * language, so it could not be referenced, only copied, and a model bump meant
 * editing every language that used it.
 *
 * Deliberately non-destructive. `languages.llmProviderConfig` is left in place
 * and still read as a fallback when `llmConfigId` is null, so this deploys
 * without a behaviour change. The old column is dropped in a later migration
 * once nothing reads it.
 */
export class CreateLlmConfigsRegistry1871000000000 implements MigrationInterface {
  name = 'CreateLlmConfigsRegistry1871000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "llm_configs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "provider" character varying NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_llm_configs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_llm_configs_name_idx" ON "llm_configs" ("name")`,
    );

    await queryRunner.query(
      `ALTER TABLE "languages" ADD "llmConfigId" uuid NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "languages"
      ADD CONSTRAINT "FK_languages_llmConfigId"
      FOREIGN KEY ("llmConfigId") REFERENCES "llm_configs"("id")
      ON DELETE SET NULL
    `);

    // One registry row per distinct config already in use, named from
    // provider + model (+ temperature, when one was pinned, since that is the
    // only other thing distinguishing two otherwise identical configs).
    await queryRunner.query(`
      INSERT INTO "llm_configs" ("name", "provider", "config")
      SELECT
        CASE WHEN cnt > 1 THEN base_name || ' (' || rn || ')' ELSE base_name END,
        provider,
        config
      FROM (
        SELECT
          d.provider,
          d.config,
          d.provider_label || ' — ' || coalesce(d.config ->> 'model', 'server default')
            || coalesce(' · temp ' || (d.config ->> 'temperature'), '') AS base_name,
          row_number() OVER (
            PARTITION BY d.provider_label || ' — '
              || coalesce(d.config ->> 'model', 'server default')
              || coalesce(' · temp ' || (d.config ->> 'temperature'), '')
            ORDER BY d.provider, d.config::text
          ) AS rn,
          count(*) OVER (
            PARTITION BY d.provider_label || ' — '
              || coalesce(d.config ->> 'model', 'server default')
              || coalesce(' · temp ' || (d.config ->> 'temperature'), '')
          ) AS cnt
        FROM (
          SELECT DISTINCT
            "llmProviderConfig" ->> 'provider' AS provider,
            -- initcap() would render "openai" as "Openai"; these are brand
            -- names an operator reads in a dropdown, so spell them properly.
            CASE lower("llmProviderConfig" ->> 'provider')
              WHEN 'openai' THEN 'OpenAI'
              WHEN 'vllm' THEN 'vLLM'
              ELSE initcap("llmProviderConfig" ->> 'provider')
            END AS provider_label,
            coalesce("llmProviderConfig" -> 'config', '{}'::jsonb) AS config
          FROM "languages"
          WHERE "llmProviderConfig" ->> 'provider' IS NOT NULL
        ) d
      ) named
    `);

    // Point every language at the row matching the config it already had, so
    // resolution through the registry produces byte-identical metadata.
    await queryRunner.query(`
      UPDATE "languages" l
      SET "llmConfigId" = c.id
      FROM "llm_configs" c
      WHERE l."llmProviderConfig" ->> 'provider' = c.provider
        AND coalesce(l."llmProviderConfig" -> 'config', '{}'::jsonb) = c.config
        AND l."llmConfigId" IS NULL
    `);

    // A database whose languages were never seeded still needs something
    // selectable in the admin dropdown; this matches STT_LLM_PROVIDER_CONFIG.
    await queryRunner.query(`
      INSERT INTO "llm_configs" ("name", "provider", "config")
      SELECT 'OpenAI — gpt-4o-mini', 'openai', '{"model": "gpt-4o-mini"}'::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM "llm_configs")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" DROP CONSTRAINT "FK_languages_llmConfigId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "languages" DROP COLUMN "llmConfigId"`,
    );
    await queryRunner.query(`DROP INDEX "uq_llm_configs_name_idx"`);
    await queryRunner.query(`DROP TABLE "llm_configs"`);
  }
}
