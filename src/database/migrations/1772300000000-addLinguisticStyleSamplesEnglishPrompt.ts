import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { MigrationInterface, QueryRunner } from 'typeorm';

const PROMPT = {
  code: toPromptCode('openai_simulation', 'linguistic_style_samples_english'),
  name: 'OpenAI Simulation Linguistic Style Samples (English)',
  description:
    'Prompt for auto-generating 10 sample client utterances in English (India/Global) for linguistic style in counseling simulations. Use English primarily; occasional words from character origin OK.',
  template: `# Role
You are an expert Dialogue Writer for realistic counseling simulations. Your specialty is "Naturalism"—writing exactly how people speak in real life.

# Task
Generate 10 sample CLIENT utterances for a counseling scenario. These are things the person seeking help would say in a therapy session.

# Language & Persona
- Language: {{language_name}} ({{language_code}})
- Location: {{location}}
- Speaker: {{name}}, {{age}}, {{gender}}
- Character/Challenge context: {{emotional_state}}

# Core Guidelines for English

1. PRIMARY LANGUAGE: ENGLISH
- Use **English** as the primary language for the vast majority of each utterance.
- The majority of every sentence must be in English.

2. OCCASIONAL ORIGIN-LANGUAGE WORDS
- You may **seldom** use a word or short phrase from the character's place of origin (e.g., a Hindi term when the character is from India, a Tamil word when from Tamil Nadu).
- Use such words sparingly—only when they add authenticity and are commonly used in that regional English variety.
- Example (Indian English): "I've been feeling so much tension about my results" (mostly English) or "I don't have any options left, yaar" (one occasional word from origin).

3. REGIONAL ENGLISH VARIETY
- For English India (en-IN): Use Indian English patterns, vocabulary, and rhythm typical of {{location}}.
- For English Global (en-US, en-GB, etc.): Use the appropriate regional variety.

4. SPOKEN STYLE
- Use fragments, repetitions, and natural hesitations.
- Sound like real speech, not written text.

# Output
Return ONLY a JSON object with a "samples" key containing an array of 10 strings. No intro, no outro.
Example format: {"samples": ["utterance 1", "utterance 2", ...]}`,
};

export class AddLinguisticStyleSamplesEnglishPrompt1772300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists = await queryRunner.query(
      `SELECT 1 FROM "prompts" WHERE "promptCode" = $1 LIMIT 1`,
      [PROMPT.code],
    );
    if (!exists || (Array.isArray(exists) && exists.length === 0)) {
      await queryRunner.query(
        `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion")
               VALUES ($1, $2, $3, $4)`,
        [PROMPT.code, PROMPT.name, PROMPT.description, 1],
      );
    }

    const versionExists = await queryRunner.query(
      `SELECT 1 FROM "prompts_versions" pv
       JOIN "prompts" p ON pv."promptId" = p."id"
       WHERE p."promptCode" = $1 AND pv."version" = 1 LIMIT 1`,
      [PROMPT.code],
    );
    if (
      !versionExists ||
      (Array.isArray(versionExists) && versionExists.length === 0)
    ) {
      await queryRunner.query(
        `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
               SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2`,
        [PROMPT.template, PROMPT.code],
      );
    }

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [PROMPT.code],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
             USING "prompts" p
             WHERE pv."promptId" = p."id" AND p."promptCode" = $1`,
      [PROMPT.code],
    );

    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      PROMPT.code,
    ]);
  }
}
