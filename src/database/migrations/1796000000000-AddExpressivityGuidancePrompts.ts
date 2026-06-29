import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registers two non-v3 inline voice-expression prompts in prompt management so
 * superadmins can edit them AND they reach ally-ai-learn at runtime:
 *  - ally_ai_learn_system_text_expressivity_guidance — performative plain-text
 *    delivery for any non-v3 voice (opt-in via enablePerformativeText).
 *  - ally_ai_learn_system_break_tag_guidance — <break .../> pauses for
 *    ElevenLabs non-v3 voices (opt-in via enableBreakTags).
 *
 * Same mechanism as AddAudioTagGuidancePrompt: the `ally_ai_learn_` prefix +
 * useDashboardOverride=true is what getPromptsForScenarioSession() filters on, so
 * these bodies are bundled into live-session room metadata and appended to the
 * persona prompt by generate_response when the scenario opts in. Canonical local
 * fallbacks live in ally-ai-learn at app/prompts/system/text_expressivity_guidance.txt
 * and break_tag_guidance.txt; these v1 bodies mirror them. The ON CONFLICT clause
 * keeps useDashboardOverride=true even if the file-sync created the row first.
 */
export class AddExpressivityGuidancePrompts1796000000000
  implements MigrationInterface
{
  name = 'AddExpressivityGuidancePrompts1796000000000';

  // Keep each body in sync with the canonical ally-ai-learn .txt files.
  private readonly prompts: ReadonlyArray<{
    code: string;
    name: string;
    description: string;
    promptType: string;
    body: string;
  }> = [
    {
      code: 'ally_ai_learn_system_text_expressivity_guidance',
      name: 'Text Expressivity Guidance',
      description:
        'Performative-text voice expression for non-v3 voices (punctuation, ' +
        'pacing, disfluencies — no markup). Appended to the persona prompt when ' +
        'the scenario opts in (enablePerformativeText). No template variables.',
      promptType: 'text_expressivity_guidance',
      body: `Convey emotion, mood, and pacing using ONLY the words and punctuation of your
reply. These cues are interpreted by every voice; use them naturally and
sparingly so speech sounds human, not theatrical.

Punctuation & pacing:
- Ellipses (…) for hesitation, trailing off, or a thoughtful pause.
- Em-dash (—) for an abrupt break, a self-correction, or an interruption.
- Commas and full stops to control rhythm: shorter sentences read faster and
  more urgent, longer ones calmer.
- "?" for genuine questions or uncertainty; "!" sparingly, for real emphasis or
  surprise.

Spoken disfluencies & reactions (a light touch — not every line):
- Filled pauses and softeners: "um", "uh", "hmm", "well…", "you know", "I mean".
- Reactions spoken as words: "oh", "ah", "haha", "ugh", "phew".
- Fragments, false starts, and gentle repetition for emotion or vulnerability,
  e.g. "I— I'm not sure I can." Vary sentence length to match the feeling.

CRITICAL — never write stage directions or markup. Do NOT use bracketed tags
([sigh], [pause]), SSML, angle-bracket tags, asterisks (*sighs*), or any
parenthetical describing tone. They are NOT interpreted — they are read aloud to
the person, word for word. Express everything through ordinary spoken words and
punctuation only.

Therapy context: let a difficult or vulnerable admission land with an ellipsis
before or after it; let anxiety show through shorter, rushed fragments; let
heavy moments breathe with a full stop and a softer next sentence.
`,
    },
    {
      code: 'ally_ai_learn_system_break_tag_guidance',
      name: 'Break Tag Guidance',
      description:
        'Inline <break time=.../> guidance for ElevenLabs (non-v3) voices. ' +
        'Appended to the persona prompt when the scenario opts in (enableBreakTags) ' +
        'and the provider parses break tags. No template variables.',
      promptType: 'break_tag_guidance',
      body: `You may also insert literal pause markers using the break tag, which this voice
interprets as a real silence (it is NOT spoken aloud):

  <break time="0.5s" />   up to   <break time="1.5s" />

Use them sparingly, only where a deliberate beat helps — before a vulnerable
admission, after a heavy statement, or to let a thought settle. Keep durations
between 0.3s and 1.5s. Use at most one or two per reply, and never place
anything other than the exact <break time="..." /> token inside angle brackets.
`,
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.prompts) {
      await queryRunner.query(
        `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "promptType", "category", "hasStates", "availableVariables")
         VALUES ($1, $2, $3, 1, true, $4, 'System', false, '[]'::jsonb)
         ON CONFLICT ("promptCode") DO UPDATE SET "useDashboardOverride" = true`,
        [p.code, p.name, p.description, p.promptType],
      );
      await queryRunner.query(
        `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
         SELECT pr."id", 1, $1, 0, 0 FROM "prompts" pr WHERE pr."promptCode" = $2
         ON CONFLICT ("promptId", "version") DO NOTHING`,
        [p.body, p.code],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.prompts) {
      await queryRunner.query(
        `DELETE FROM "prompts_versions" WHERE "promptId" = ` +
          `(SELECT "id" FROM "prompts" WHERE "promptCode" = $1)`,
        [p.code],
      );
      await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
        p.code,
      ]);
    }
  }
}
