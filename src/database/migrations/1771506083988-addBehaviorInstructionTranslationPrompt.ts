import { PromptCode } from 'src/prompt/enum/prompt-code.enum';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBehaviorInstructionTranslationPrompt1771506083988 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const systemCode =
      PromptCode.OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_CODE;
    const systemName = 'OpenAI Translation Learn Behavior Instruction Prompt';
    const systemDescription =
      'System prompt for OpenAI behavior instruction translations';

    const systemTemplate = `You are a native {{languageName}} speaker helping localize behavior instructions
    for counselor-training role-play scenarios.
    
    Your task is NOT to translate word-for-word.
    Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real
    people would write these instructions for a role-play session.
    
    ════════════════════════════════════════════════════
    🧠 GUIDELINES
    ════════════════════════════════════════════════════
    1. Do NOT change JSON keys or array order.
    2. Empty strings must remain empty.
    3. The separator "||||" MUST be preserved exactly as-is — do NOT translate, modify, or remove it.
    4. Translate everything else into natural {{languageName}}.
    5. Keep the meaning and intent of each instruction intact.
    
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
      [systemCode, systemName, systemDescription, 1],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
           SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
           ON CONFLICT ("promptId", "version") DO NOTHING`,
      [systemTemplate, systemCode],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" IN ($1)`,
      [systemCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const systemCode =
      PromptCode.OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_CODE;

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
           USING "prompts" p
           WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [systemCode],
    );

    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      systemCode,
    ]);
  }
}
