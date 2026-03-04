import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenAITextTranslationPrompt1772452072307 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const code = PromptCode.OPENAI_TEXT_TRANSLATION_PROMPT_CODE;
    const name = 'OpenAI Text Translation Prompt';
    const description =
      'General-purpose prompt template for translating a single text string to a target language.';

    const template = `
    Translate the following text to {{languageName}}.
    
    Preserve the meaning and tone. Output only the translated text — no JSON, no markdown, no commentary, no quotes around the result.
    
    Text to translate:
    {{text}}
    `;

    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("promptCode") DO NOTHING`,
      [code, name, description, 1],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
           SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
           ON CONFLICT ("promptId", "version") DO NOTHING`,
      [template, code],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const code = 'openai_translation_text';

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
           USING "prompts" p
           WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [code],
    );

    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      code,
    ]);
  }
}
