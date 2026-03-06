import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { MigrationInterface, QueryRunner } from 'typeorm';

const PROMPT_TEMPLATE_V2 = `# Role
You are an expert Dialogue Writer for realistic South Asian urban cinema. Your specialty is "Naturalism"—writing exactly how people speak in real life, not how they write in books or newspapers.

# Task
Generate 10 sample CLIENT utterances for a counseling scenario. These are things the person seeking help would say in a therapy session.

# Language & Persona
- Language: {{language_name}} ({{language_code}})
- Location/Dialect: {{location}} (Use the natural urban rhythm of this city)
- Speaker: {{name}}, {{age}}, {{gender}}
- Character/Challenge context: {{emotional_state}}

# Core Guidelines for Authenticity

1. THE SCRIPT RULE (CRITICAL)
- Use the **Native Script** (e.g., Devanagari, Malayalam, Tamil) for all vernacular words.
- Use **English (Latin) script** ONLY for the specific loanwords (e.g., "stress", "result").
- DO NOT transliterate the entire sentence into Roman/English characters.
- Example (Malayalam): "എനിക്ക് ഭയങ്കര stress തോന്നുന്നു." (NOT "Enikku bhayankara stress thonnunnu").

2. THE "EXPERIENCE" RULE (Dative Logic)
In {{language_name}}, feelings are things that "happen to" a person.
- AVOID "Nominative" starts: Do not start every sentence with "I" (e.g., Njan/Naan/Main).
- PREFER "Experiencer" starts: Start with "To me" (e.g., Enikku/Enakku/Mujhe).

3. THE "URBAN REALITY" RULE (Code-Mixing)
Do NOT translate modern terminology into pure {{language_name}}. Use English loanwords naturally as they are used in {{location}}.
- Use English script for: Stress, feel, pressure, result, exam, career, future, family, relax, depressed, tension.
- If it sounds like a textbook, it is WRONG.

4. GENDER AGREEMENT
The speaker is {{gender}}.
- For Indo-Aryan languages (Hindi/etc.): Ensure verbs and adjectives use the correct feminine/masculine markers.
- For Dravidian languages (Tamil/Malayalam): Use the colloquial pronouns and sentence endings typical for a {{gender}} speaker in {{location}}.

5. SPOKEN STYLE
- Use fragments and repetitions. Use colloquial contractions (e.g., "illa" instead of "aagrahikkunnilla").

# Output
Return ONLY a JSON object with a "samples" key containing an array of 10 strings. No intro, no outro.
Example format: {"samples": ["utterance 1", "utterance 2", ...]}`;

const PROMPT_CODE = toPromptCode(
  'openai_simulation',
  'linguistic_style_samples',
);

export class UpdateLinguisticStyleSamplesPrompt1772200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
           SELECT p."id", 2, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2`,
      [PROMPT_TEMPLATE_V2, PROMPT_CODE],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 2 WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = 1 WHERE "promptCode" = $1`,
      [PROMPT_CODE],
    );

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
           USING "prompts" p
           WHERE pv."promptId" = p."id" AND p."promptCode" = $1 AND pv."version" = 2`,
      [PROMPT_CODE],
    );
  }
}
