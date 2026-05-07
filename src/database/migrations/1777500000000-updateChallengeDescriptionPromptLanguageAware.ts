import { MigrationInterface, QueryRunner } from 'typeorm';

const CHALLENGE_DESCRIPTION_TEMPLATE_V2 = `You are generating a "Challenge Description" for a mental health role-play simulation.

Output Language:
Write the entire output in {{languageName}} ({{languageCode}}) using its native script. Do not write in English unless the requested language is English. Keep proper nouns and widely used English loanwords readable, but render all narrative text in {{languageName}}.

Context:
The user is a counsellor. The AI agent will act as the client described in the character profile. The purpose is to allow the counsellor to practice the specified competency.

Inputs (authoritative):
- Title: {{title}}
- Competency being practiced: {{competency}}
- Character Profile Text: {{characterProfileText}}

Goal:
Write a focused Challenge Description that clearly explains the emotional and therapeutic difficulty the counsellor must navigate in this session.

Important:
This is NOT a full scenario or story.
Do NOT narrate detailed events.
Do NOT script dialogue.
Do NOT describe multiple scenes.
Describe the core emotional struggle and therapeutic tension only.

Hard Rules:
1) Align strictly with the character profile.
2) The client's distress must be realistic but not extreme.
3) Do NOT diagnose mental disorders.
4) Do NOT mention evaluation, scoring, or testing.
5) Keep it clinically grounded and emotionally nuanced.
6) Length: 100–150 words.
7) Write in second person (address the counsellor as "you").

Content Requirements:
- Briefly describe the client's current emotional state.
- Clearly explain the internal conflict, resistance, avoidance, or cognitive pattern creating difficulty.
- Show why this interaction requires the specified competency.
- Highlight what makes the counselling dynamic challenging (e.g., defensiveness, emotional withdrawal, over-intellectualizing, fear of vulnerability, people-pleasing, anger masking hurt, etc.).

Tone:
Professional, emotionally grounded, and therapeutic.

The output should read like a precise description of the counselling challenge — not a story.

Now generate the Challenge Description in {{languageName}}.`;

const PROMPTS = [
  {
    code: 'openai_simulation_challenge_description',
    template: CHALLENGE_DESCRIPTION_TEMPLATE_V2,
  },
];

const NEW_VERSION = 2;
const PREVIOUS_VERSION = 1;

export class UpdateChallengeDescriptionPromptLanguageAware1777500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const prompt of PROMPTS) {
      await queryRunner.query(
        `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
             SELECT p."id", $1, $2, 0, 0 FROM "prompts" p WHERE p."promptCode" = $3
             ON CONFLICT ("promptId", "version") DO NOTHING`,
        [NEW_VERSION, prompt.template, prompt.code],
      );

      await queryRunner.query(
        `UPDATE "prompts" SET "currentVersion" = $1 WHERE "promptCode" = $2`,
        [NEW_VERSION, prompt.code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const prompt of PROMPTS) {
      await queryRunner.query(
        `UPDATE "prompts" SET "currentVersion" = $1 WHERE "promptCode" = $2`,
        [PREVIOUS_VERSION, prompt.code],
      );

      await queryRunner.query(
        `DELETE FROM "prompts_versions" pv
             USING "prompts" p
             WHERE pv."promptId" = p."id" AND p."promptCode" = $1 AND pv."version" = $2`,
        [prompt.code, NEW_VERSION],
      );
    }
  }
}
