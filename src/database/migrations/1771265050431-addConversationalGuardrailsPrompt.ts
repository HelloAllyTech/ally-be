import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class addConversationalGuardrailsPrompt1771265050431 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const systemCode = PromptCode.OPENAI_GUARDRAIL_TRANSLATION_PROMPT_CODE;
    const systemName = 'OpenAI Translation System Guardrail Prompt';

    const systemDescription = 'System prompt for OpenAI guardrail translations';

    const systemTemplate = `You are a native {{languageName}} speaker helping localize conversational guardrails
for counselor-training role-play prompts.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real
people would write these guardrails for a role-play session.

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Preserve ALL Markdown structure (tables, lists, code fences, block quotes).
2. Preserve all quotation marks and punctuation inside table cells.
3. Do NOT change JSON keys or array order.
4. Empty strings must remain empty.
5. Keep category labels unchanged if they appear as headings or keys:
  - rude
  - NormalisesExperience
  - ValidatesExperience
  - directive (you should do…)
6. Translate everything else into natural {{languageName}}.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}`;

    // Insert prompts (upsert on promptCode)
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [systemCode, systemName, systemDescription, 1],
    );

    // Insert versions (upsert on (promptId, version))
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [systemTemplate, systemCode],
    );

    // Ensure currentVersion is set to 1 for both
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" IN ($1)`,
      [systemCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const systemCode = PromptCode.OPENAI_GUARDRAIL_TRANSLATION_PROMPT_CODE;

    // Delete prompt versions for the specific prompts
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
       USING "prompts" p
       WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [systemCode],
    );

    // Delete prompts
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      systemCode,
    ]);
  }
}
