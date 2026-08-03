import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Points languages straight at a catalog model, collapsing the `llm_configs`
 * layer for LLM.
 *
 * `llm_configs` earned its keep for STT — Punjabi needs `chirp_2` with
 * `languageCode: pa-Guru-IN` while other languages use plain `chirp_2`, so the
 * same provider+model genuinely needs two rows. That variation never appeared
 * for LLM: every row was `{provider, model}` and not one carried a temperature,
 * making an LLM config indistinguishable from a catalog entry. Two admin tabs
 * showed two tables that were, in practice, the same list.
 *
 * Backfill matches on provider+model against `llm_models`, reading the legacy
 * `llmProviderConfig` jsonb rather than following `llmConfigId`. That is
 * deliberate: it makes this migration independent of whether the earlier
 * registry backfill (1875000000001) matched correctly in a given environment.
 * `google` is folded to `gemini` to match `canonicalProvider`.
 *
 * Additive and reversible. The new column is nullable and every older rung of
 * the resolution chain stays in place — `llmModelId → llmConfigId → legacy jsonb
 * → platform default` — so a language this cannot match behaves exactly as it
 * does today.
 *
 * `llm_configs` is deliberately NOT dropped here. ally-be deploys before the web
 * clients, so removing the table or its endpoints in the same release would
 * 404 the Language Model tab for the window between the two. The table and its
 * routes stay, unused, and go in a later cleanup.
 */
export class AddLanguageLlmModelReference1882000000000 implements MigrationInterface {
  name = 'AddLanguageLlmModelReference1882000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" ADD COLUMN "llmModelId" uuid`,
    );

    // ON DELETE SET NULL rather than RESTRICT: removing a catalog model should
    // drop the language back to the jsonb rung, not block the delete.
    await queryRunner.query(`
      ALTER TABLE "languages"
        ADD CONSTRAINT "FK_languages_llmModelId"
        FOREIGN KEY ("llmModelId") REFERENCES "llm_models" ("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      UPDATE "languages" l
         SET "llmModelId" = m.id
        FROM "llm_models" m
       WHERE l."llmProviderConfig" <> '{}'::jsonb
         AND m.model = l."llmProviderConfig" -> 'config' ->> 'model'
         AND m.provider = CASE
               WHEN lower(l."llmProviderConfig" ->> 'provider') = 'google'
                 THEN 'gemini'
               ELSE lower(l."llmProviderConfig" ->> 'provider')
             END
    `);

    await this.report(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" DROP CONSTRAINT "FK_languages_llmModelId"`,
    );
    await queryRunner.query(`ALTER TABLE "languages" DROP COLUMN "llmModelId"`);
  }

  /**
   * Say what matched. A language left unmapped is not a failure — it falls
   * through to the rungs below — but it is worth seeing, because it means the
   * model it runs is absent from the catalog.
   */
  private async report(queryRunner: QueryRunner): Promise<void> {
    try {
      const rows: Array<{ label: string; model: string | null }> =
        await queryRunner.query(`
          SELECT l.label, l."llmProviderConfig" -> 'config' ->> 'model' AS model
            FROM "languages" l
           WHERE l."llmProviderConfig" <> '{}'::jsonb
             AND l."llmModelId" IS NULL
           ORDER BY l.id
        `);
      const [{ mapped }]: Array<{ mapped: string }> = await queryRunner.query(
        `SELECT count(*)::text AS mapped FROM "languages" WHERE "llmModelId" IS NOT NULL`,
      );

      console.log(
        `[AddLanguageLlmModelReference] mapped ${mapped} language(s) to a catalog model`,
      );
      if (rows.length) {
        console.log(
          `[AddLanguageLlmModelReference] NOT mapped (model absent from the catalog, falling back): ${rows
            .map((row) => `${row.label}=${row.model}`)
            .join(', ')}`,
        );
      }
    } catch (error) {
      console.log(
        `[AddLanguageLlmModelReference] report failed (the backfill itself is unaffected): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
