import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registers the ElevenLabs v3 inline audio-tag guidance in prompt management so
 * superadmins can edit it AND it reaches ally-ai-learn at runtime.
 *
 * The `ally_ai_learn_` prefix + `useDashboardOverride = true` is exactly what
 * getPromptsForScenarioSession() filters on, so this body is bundled into
 * live-session room metadata (prompt_data.prompts[...]). ally-ai-learn's
 * generate_response then appends it to the persona prompt for tag-capable
 * (ElevenLabs v3) voices — the agent emits [pause]/[sighs]/[empathetic] tags
 * inline while streaming, with no second prosody LLM call.
 *
 * The canonical local fallback lives in ally-ai-learn at
 * app/prompts/system/audio_tag_guidance.txt (synced here as `defaultPrompt` by
 * scripts/sync_prompts.py, which also keeps name/description/category aligned via
 * _meta/audio_tag_guidance.meta.json). This migration seeds the DB-backed
 * version 1 (mirroring that file) so the row is editable + flowing without
 * waiting on a sync. The ON CONFLICT clause keeps `useDashboardOverride = true`
 * even if the file-sync created the row (override=false) first.
 */
export class AddAudioTagGuidancePrompt1791000000000 implements MigrationInterface {
  name = 'AddAudioTagGuidancePrompt1791000000000';

  private readonly promptCode = 'ally_ai_learn_system_audio_tag_guidance';

  // Keep this in sync with ally-ai-learn/app/prompts/system/audio_tag_guidance.txt
  // (that file is the canonical source; this v1 mirrors it as the initial DB body).
  private readonly guidance = `ElevenLabs v3 (Alpha) supports audio tags for expressive speech control.
These tags are placed inline in square brackets.

Supported audio tag categories:
- Emotions: [curious], [crying], [mischievously], [excited], [sad], [happy],
  [angry], [surprised], [calm], [empathetic]
- Delivery/pace: [whispers], [shouts], [rushed], [slow], [normal]
- Human reactions: [laughs], [sighs], [clears throat], [gasps]
- Pauses: [pause], [short pause], [long pause]

IMPORTANT NOTES:
- Audio tags are ONLY supported in v3 models
  (e.g., "eleven_v3", "eleven_multilingual_v3")
- v2 models (e.g., "eleven_turbo_v2_5", "eleven_multilingual_v2")
  do NOT support audio tags
- Tags should be placed at the beginning of sentences/phrases for best effect
- Some tags may be spoken aloud instead of interpreted
  (v3 is in alpha/research preview)
- Pause durations are approximate and may vary

THERAPY SESSION SPECIFIC RULES:
1. "Vulnerable Pause": Add [long pause] or [pause] before/after vulnerable
   admissions or difficult revelations. Example: "[long pause] I've never told
   anyone this before [pause] but..."
2. "Anxious Rush": Use [rushed] at the start of sentences when character is
   anxious or overwhelmed. Example: "[rushed] I just can't seem to catch my
   breath [pause] everything feels so overwhelming."
3. "Heavy Sigh": Add [sighs] or [clears throat] before heavy emotional moments
   or when processing difficult information. Example: "[sighs] I've been
   carrying this for so long [pause] I don't even know where to start."
4. "Processing Break": Add [pause] or [long pause] when character is
   processing difficult emotions or trauma. Example: "That memory [pause] it's
   still so vivid [long pause] I can feel it in my body."

GENERAL USAGE:
1. Place emotion/delivery tags at the start of sentences or phrases
2. Use pause tags between phrases for natural rhythm
3. Combine tags naturally: "[surprised] Really? [pause] I didn't expect that."
4. Avoid overusing tags - use them for emphasis and natural expression
5. For therapy sessions, prioritize vulnerable pauses and processing breaks
   to create space for emotional processing

Examples:
- "[empathetic] I understand how you're feeling. [pause] That must be really difficult."
- "[sighs] I've been thinking about this a lot [long pause] and I realize..."
- "[rushed] I just can't stop worrying [pause] it's like my mind won't shut off."
- "[calm] Let's take a deep breath. [short pause] Everything will be okay."
`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "promptType", "category", "hasStates", "availableVariables")
       VALUES ($1, $2, $3, 1, true, 'audio_tag_guidance', 'System', false, '[]'::jsonb)
       ON CONFLICT ("promptCode") DO UPDATE SET "useDashboardOverride" = true`,
      [
        this.promptCode,
        'Audio Tag Guidance',
        'Inline ElevenLabs v3 audio-tag guidance ([pause], [sighs], [empathetic], ' +
          '...) appended to the persona prompt so tag-capable (v3) voices emit ' +
          'voice tags inline. No template variables.',
      ],
    );
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [this.guidance, this.promptCode],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" = ` +
        `(SELECT "id" FROM "prompts" WHERE "promptCode" = $1)`,
      [this.promptCode],
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
      this.promptCode,
    ]);
  }
}
