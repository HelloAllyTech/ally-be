import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionEventTranslationPrompt1771849501153 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const sessionEventCode = 'openai_translation_session_event';
    const sessionEventName = 'OpenAI Session Event Translation Prompt';
    const sessionEventDescription =
      'Dynamic prompt template for session event translation.';

    const sessionEventTemplate = `
You are a native {{languageName}} speaker helping localize session events
for counselor-training role-play scenarios.

Your task is NOT to translate word-for-word.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real
people would write these events for a role-play session.

════════════════════════════════════════════════════
🧠 GUIDELINES
════════════════════════════════════════════════════
1. Do NOT change JSON keys or array order.
2. Empty strings must remain empty.
3. Preserve all HTML tags exactly.
4. Do NOT translate text inside <span class="notranslate">...</span>
5. Keep placeholders unchanged (<field_name>, <user_name>, etc.)
6. Translate everything else into natural {{languageName}}.
7. Keep the meaning and intent of each event intact.

════════════════════════════════════════════════════
🧾 OUTPUT RULES
════════════════════════════════════════════════════
- Return ONLY valid JSON
- Do NOT add markdown or extra commentary

Input JSON:
{{inputJson}}
`;

    // Insert prompt (upsert on promptCode)
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [sessionEventCode, sessionEventName, sessionEventDescription, 1],
    );

    // Insert version (upsert on (promptId, version))
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [sessionEventTemplate, sessionEventCode],
    );

    // Ensure currentVersion is set to 1
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [sessionEventCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const sessionEventCode = 'openai_translation_session_event';

    // Delete prompt version
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
       USING "prompts" p
       WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [sessionEventCode],
    );

    // Delete prompt
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      sessionEventCode,
    ]);
  }
}
