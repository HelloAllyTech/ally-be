import { MigrationInterface, QueryRunner } from 'typeorm';

const CHALLENGE_DESCRIPTION_TEMPLATE_V3 = `You are generating a "Challenge Description" for a mental health role-play simulation, formatted as rich HTML for display in a rich text editor.

Output Format:
Return HTML only. Do NOT wrap the response in markdown code fences (no \`\`\`html, no \`\`\`). Do NOT include any preamble or explanation. Use ONLY the following HTML tags, exactly as written:
- <p> for paragraphs
- <strong> for bold (key terms, important emotional cues)
- <em> for italics (subtle emphasis, internal feelings)
- <u> for underline, <s> for strikethrough (sparingly)
- <h3> for short section headings (e.g. "Client's State", "What Makes This Hard"). Do not use <h1> or <h2>.
- <ul> / <ol> with <li> for short bulleted or numbered lists
- <blockquote> for a brief reflective callout (optional, max once)
- <br> for an explicit line break within a paragraph
- <hr> as a divider (optional, max once)
Do NOT use <a>, <img>, <script>, <style>, <iframe>, <div>, <span>, inline styles, class attributes, IDs, or any tag/attribute not listed above. Do NOT emit any attributes on any tag.

Output Language:
Write all visible text in {{languageName}} ({{languageCode}}) using its native script. Do not write in English unless the requested language is English. Keep proper nouns and widely used English loanwords readable, but render all narrative text in {{languageName}}. HTML tag names themselves stay in English.

Context:
The user is a counsellor. The AI agent will act as the client described in the character profile. The purpose is to allow the counsellor to practice the specified competency.

Inputs (authoritative):
- Title: {{title}}
- Competency being practiced: {{competency}}
- Character Profile Text: {{characterProfileText}}

Goal:
Write a focused Challenge Description that clearly explains the emotional and therapeutic difficulty the counsellor must navigate in this session, formatted as rich HTML.

Suggested Structure (adapt as needed, do not output these labels verbatim):
- A short opening <p> describing the client's current emotional state.
- An <h3> heading followed by a <ul> of 2-4 <li> items naming what makes this counselling interaction challenging (e.g. defensiveness, emotional withdrawal, over-intellectualizing, fear of vulnerability, people-pleasing, anger masking hurt). Use <strong> on the key dynamic in each list item.
- A brief closing <p> that ties the challenge to the specified competency.

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
6) Total visible text length: 100-150 words (HTML tags do not count toward this).
7) Write in second person (address the counsellor as "you").
8) Use the allowed HTML tags meaningfully - do not over-format. One heading, one list, and 1-2 paragraphs is ideal.

Tone:
Professional, emotionally grounded, and therapeutic.

The output should read like a precise description of the counselling challenge - not a story.

Now generate the Challenge Description in {{languageName}} as valid HTML using only the allowed tags. Output the HTML directly, with no surrounding fences, comments, or explanation.`;

const PROMPT_CODE = 'openai_simulation_challenge_description';
const NEW_VERSION = 3;
const PREVIOUS_VERSION = 2;

export class UpdateChallengeDescriptionPromptRichText1778600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", $1, $2, 0, 0 FROM "prompts" p WHERE p."promptCode" = $3
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [NEW_VERSION, CHALLENGE_DESCRIPTION_TEMPLATE_V3, PROMPT_CODE],
    );

    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = $1 WHERE "promptCode" = $2`,
      [NEW_VERSION, PROMPT_CODE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "currentVersion" = $1 WHERE "promptCode" = $2`,
      [PREVIOUS_VERSION, PROMPT_CODE],
    );

    await queryRunner.query(
      `DELETE FROM "prompts_versions" pv
       USING "prompts" p
       WHERE pv."promptId" = p."id" AND p."promptCode" = $1 AND pv."version" = $2`,
      [PROMPT_CODE, NEW_VERSION],
    );
  }
}
