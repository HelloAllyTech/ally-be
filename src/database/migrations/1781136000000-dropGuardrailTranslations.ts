import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guardrails are no longer translated — the same guardrail boundary/instruction
 * applies to every language (the classifier judges any-language utterances and
 * the branching prompt makes the actor reply in the session language). This
 * drops the now-unused translations table and removes the orphaned OpenAI
 * guardrail-translation prompt.
 */
export class DropGuardrailTranslations1781136000000 implements MigrationInterface {
  name = 'DropGuardrailTranslations1781136000000';

  private readonly promptCode = 'openai_translation_guardrail_translation';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_conversational_guard_translations_guard_id_lang_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "conversational_guardrails_translations"`,
    );

    // Remove the orphaned translation prompt (file already deleted, so the
    // prompt-sync will not recreate it).
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" IN (SELECT id FROM "prompts" WHERE "promptCode" = $1)`,
      [this.promptCode],
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      this.promptCode,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the table schema (the prompt content is not restored).
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "conversational_guardrails_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "guardrailId" character varying NOT NULL, "languageId" integer NOT NULL, "helperDialogue" character varying NOT NULL, "actorDialogue" character varying NOT NULL, CONSTRAINT "PK_52729a61bba78e48a680fec28f5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_conversational_guard_translations_guard_id_lang_id_idx" ON "conversational_guardrails_translations" ("guardrailId", "languageId")`,
    );
  }
}
