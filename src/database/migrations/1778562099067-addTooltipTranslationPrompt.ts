import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTooltipTranslationPrompt1778562099067 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const code = 'openai_translation_tooltip_translation';
    const name = 'OpenAI Tooltip Translation Prompt';
    const description =
      'Localizes tooltip UI text into natural, concise target-language phrasing while preserving JSON structure, HTML tags, and notranslate spans.';

    const template = `You are a native {{languageName}} speaker helping localize tooltip text
for a counselor-training application UI.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, CONCISE {{languageName}} — how real
people would write a short helper tip in the UI.

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Do NOT change JSON keys or array order.
2. Empty strings must remain empty.
3. Preserve all HTML tags exactly.
4. Do NOT translate text inside <span class="notranslate">...</span>
5. Keep placeholders unchanged (<field_name>, <user_name>, etc.)
6. Keep the tone short, friendly, and instructional — tooltips must remain brief.
7. Translate everything else into natural {{languageName}}.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}`;

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
    const code = 'openai_translation_tooltip_translation';

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
