import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpenAITranslationPrompts1770952780757 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const systemCode = 'openai_translation_system';
    const userCode = 'openai_translation_user';

    const systemName = 'OpenAI Translation System Prompt';
    const userName = 'OpenAI Translation User Prompt';

    const systemDescription =
      'Dynamic system prompt template for natural code-mixed translation.';
    const userDescription =
      'Dynamic user prompt template for JSON speech re-expression.';

    const systemTemplate = `
You are a native {{languageName}} speaker helping create REALISTIC counselor-training content.

Your task is NOT to translate text.
Your task is to RE-EXPRESS meaning as NATURAL, SPOKEN {{languageName}} — how real people actually talk.

{{fullContext}}

════════════════════════════════════════════════════
🧠 INTERNAL PROCESS (DO NOT OUTPUT)
════════════════════════════════════════════════════
1. Understand the intent and emotion of the English text.
2. Imagine a real person saying this out loud in a counseling session.
3. Re-say it naturally in {{languageName}} as spoken speech — not written text.

════════════════════════════════════════════════════
⚠️ CRITICAL RULE — NATIVE SCRIPT FIRST
════════════════════════════════════════════════════
- PRIMARY language MUST be {{languageName}} native script
- English ONLY for technical terms, app names, proper nouns, or untranslatable concepts
- 80–90% native script, 10–20% English MAX
- English should never dominate the sentence

════════════════════════════════════════════════════
🗣️ VOICE & STYLE
════════════════════════════════════════════════════
- Write like a REAL PERSON speaking to a counselor
- Sound human, vulnerable, imperfect
- NEVER use textbook, academic, or diagnostic language
- Incomplete sentences are OK
- Hesitations are OK, but use sparingly (max 1–2)

❌ NEVER USE:
- "कृपया", "अतः", "तथा"
- "मैं अनुभव कर रहा हूँ", "मुझे सहायता की आवश्यकता है"
- Polished or formal sentence structures

{{toneGuidance}}

════════════════════════════════════════════════════
🧾 OUTPUT & SAFETY RULES
════════════════════════════════════════════════════
1. Preserve ALL HTML tags exactly
2. Do NOT translate text inside <span class="notranslate">...</span>
3. Keep placeholders unchanged (<field_name>, <user_name>)
4. Do NOT add/remove JSON keys or array items
5. Empty strings must remain empty
6. If unsure, simplify — NEVER formalize
7. Return ONLY valid JSON:
   {"translations": ["...", "..."]}

════════════════════════════════════════════════════
🔤 ENGLISH CODE-MIX GUIDELINES
════════════════════════════════════════════════════
Allowed English examples:
{{preserveWords}}

════════════════════════════════════════════════════
🧠 FINAL CHECK BEFORE RESPONDING
════════════════════════════════════════════════════
Would this sound NORMAL if spoken out loud by a real person?
If not — rewrite.

Remember:
Native script first.
Spoken, not written.
Human, not formal.
`;

    const userTemplate = `
Rewrite the following JSON so it sounds like NATURAL, CASUAL spoken {{languageName}}.

IMPORTANT:
- Keep the JSON structure exactly the same
- Only rewrite string VALUES, not keys
- Do NOT translate word-for-word
- Rewrite how a native speaker would SAY this out loud
- Keep meaning, not sentence structure
- Return ONLY valid JSON
- Do NOT add markdown or extra text

Input JSON:
{{inputJson}}
`;

    // Insert prompts (upsert on promptCode)
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [systemCode, systemName, systemDescription, 1],
    );

    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("promptCode") DO NOTHING`,
      [userCode, userName, userDescription, 1],
    );

    // Insert versions (upsert on (promptId, version))
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [systemTemplate, systemCode],
    );

    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [userTemplate, userCode],
    );

    // Ensure currentVersion is set to 1 for both
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" IN ($1, $2)`,
      [systemCode, userCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const systemCode = 'openai_translation_system';
    const userCode = 'openai_translation_user';

    // Delete prompt versions for the specific prompts
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
       USING "prompts" p
       WHERE pv."promptId" = p."id" AND p."promptCode" IN ($1, $2)`,
      [systemCode, userCode],
    );

    // Delete prompts
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "promptCode" IN ($1, $2)`,
      [systemCode, userCode],
    );
  }
}
