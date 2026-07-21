import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prompt template auto-translation (Indian languages) — foundation.
 *
 * - `prompt_translations` — one row per (prompt, language) holding the current
 *   translated body of a `main_agent`/`branching` prompt template. Runtime only
 *   ever needs the *current* body's translation (override-on prompts resolve
 *   `currentVersion`; file-backed prompts resolve the file), so this table keeps
 *   a single live row per language and is overwritten on re-translation rather
 *   than accumulating per-version rows.
 *   - `sourceHash` is the correctness key: at runtime a translation is served
 *     only if its `sourceHash` still equals the hash of the current English body.
 *   - `promptVersionId` is provenance only (nullable — NULL for file-backed
 *     prompts that have no `prompts_versions` row).
 *
 * - `prompts.translationEnabled` — opt-in marker identifying a true English
 *   source. The team has manually created localized (Tamil/Kannada) variant rows
 *   in the dashboard DB that are indistinguishable from English sources by
 *   schema, so translation is never auto-detected: the trigger, backfill, and
 *   runtime self-heal all gate on this flag.
 */
export class CreatePromptTranslations1854000000000 implements MigrationInterface {
  name = 'CreatePromptTranslations1854000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "translationEnabled" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "prompt_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promptId" uuid NOT NULL,
        "languageId" integer NOT NULL,
        "promptVersionId" uuid,
        "translatedPrompt" text,
        "sourceHash" character varying(64) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "provider" character varying(50),
        "model" character varying(100),
        "translationPromptVersion" character varying(50),
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prompt_translations_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_prompt_translations_prompt_language" UNIQUE ("promptId", "languageId"),
        CONSTRAINT "FK_prompt_translations_promptId" FOREIGN KEY ("promptId")
          REFERENCES "prompts" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prompt_translations_languageId" FOREIGN KEY ("languageId")
          REFERENCES "languages" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_prompt_translations_promptVersionId" FOREIGN KEY ("promptVersionId")
          REFERENCES "prompts_versions" ("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_prompt_translations_language" ON "prompt_translations" ("languageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_prompt_translations_status" ON "prompt_translations" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_prompt_translations_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_prompt_translations_language"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "prompt_translations"`);
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "translationEnabled"`,
    );
  }
}
