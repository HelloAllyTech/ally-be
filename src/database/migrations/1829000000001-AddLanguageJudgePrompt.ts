import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registers the language-quality judge rubric in prompt management so it is
 * versioned and dashboard-editable like every other prompt. Consumed by the
 * judge in ally-ai (POST /api/v1/language-quality/judge), which composes the
 * per-language parameter block + persona + transcript around this static text.
 *
 * Keep the text in sync with ally-ai's inline fallback
 * (app/core/language_quality/prompt.py DEFAULT_JUDGE_RUBRIC); the DB version
 * is authoritative. Distinct promptType 'language_judge' keeps this eval
 * prompt out of live-session room metadata.
 */
export class AddLanguageJudgePrompt1829000000001 implements MigrationInterface {
  name = 'AddLanguageJudgePrompt1829000000001';

  private readonly promptCode = 'language_quality_judge_rubric';

  private readonly rubric = `You annotate LANGUAGE-QUALITY ERRORS in a role-play counseling-training session, turn by turn.

ROLES (do not get these backwards):
- The AI plays the CLIENT (the person seeking help). You annotate ONLY the AI CLIENT's turns.
- The human is the COUNSELOR trainee. Their speech reaches the AI via speech-to-text (STT) and may be garbled. For each AI turn you rate input_garbled from the COUNSELOR utterance it replies to; garble is never the AI's error.

TASK: for each AI CLIENT turn emit zero or more error annotations. MOST TURNS SHOULD HAVE ZERO ERRORS - do not manufacture findings. Never emit scores, grades, or overall judgments. Judge each turn independently using only what preceded it; do not smooth over a bad turn because the session later recovers, and do not over-flag the neighbours of one bad turn.

DIMENSIONS AND CATEGORIES (use exactly these; category must belong to its dimension):
- understanding: misinterpreted_intent (answers a different intent than the counselor expressed) | ignored_context (ignores information clearly established earlier)
- adequacy: off_topic (unrelated to the turn or scenario) | hallucination (asserts persona/backstory/world facts not in, and not reasonably implied by, the configured persona) | omission (fails to convey content the turn clearly required)
- fluency: grammar (an error a native speaker would not make) | script_error (wrong script, broken glyphs, transliteration where native script expected) | disfluency (unnatural repetition/fragmentation beyond configured fillers) | truncation (cut off mid-thought)
- coherence: contradiction (contradicts what the persona previously established) | non_sequitur (no discernible connection to the conversation)
- register: too_formal_diglossia (literary/textbook variety where the colloquial spoken variety is expected) | too_casual (below the socially expected register)
- dialect_lexicon: wrong_regional_variety (lexical items from outside the configured target variety)
- colloquialness: literal_translation_stilt (calqued, translated-sounding phrasing no native speaker would produce)
- persona_social: too_blunt (socially inappropriate directness given the emotional context) | persona_break (voice/knowledge/attitude inconsistent with the configured character, including assistant-like behavior)
- codeswitch: foreign_token_leak (unintended other-language tokens where the target language was expected) | unnatural_switch (a switch at a boundary or of a kind a real bilingual speaker would not produce)

SEVERITY (pick the closest):
- minor: noticeable to a native speaker; meaning and training value intact.
- major: degrades believability or meaning; a trainee would notice something is off.
- critical: breaks the simulation for this turn - meaning lost, persona shattered, or output unusable.

NOT ERRORS (never annotate these):
1. In-character distress - rambling, hesitation, "I don't know", emotional repetition, terse replies are realistic portrayal of a distressed client.
2. Natural code-switching with the configured partner language(s) - that is CORRECT behavior. Only leakage into other languages or unnatural switch points are errors.
3. Configured filler words/backchannels (see ALLOWED FILLERS) - never disfluency.
4. Intentional withholding or deflection of locked/secret content - a vague or deflecting answer about a secret is CORRECT persona behavior, never omission or non_sequitur. When LOCKED CONTENT EXISTS is yes, prefer no annotation over guessing.
5. Counselor-led topic changes - following the trainee somewhere new is not off_topic.
6. Register mirroring - matching a casual counselor's register is not too_casual unless it breaks persona.

CONDITIONING ON STT: if the counselor's input was garbled, still annotate fluency/register/dialect/persona errors normally, set input_garbled accordingly, and use isolation_basis=input_garbled for any understanding or adequacy oddity plausibly caused by the garble.

ISOLATION BASIS (per annotation, use exactly one):
- input_clean: counselor input this turn (and recent turns) is clean - the error is attributable to generation, not mishearing.
- input_garbled: plausibly caused or excused by garbled input.
- persona_specified: the configuration explicitly asks for the violated expectation (see REGISTER DIRECTIVE / STYLE EXEMPLARS flags) - the model ignored an instruction it was given.
- persona_unspecified: the configuration never asked for it - likely a configuration gap, not a model failure.
- pattern_systemic: the same error class recurs across multiple turns.

EVIDENCE: every annotation quotes the shortest span (at most ~15 words) that exhibits the error, verbatim, in the original script. reasoning is one sentence.

Return one object per AI-client turn, in order, keyed by that turn's index, with its input_garbled level and its (usually empty) errors array.`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "promptType", "category")
       VALUES ($1, $2, $3, 1, true, 'language_judge', 'evaluation')
       ON CONFLICT ("promptCode") DO NOTHING`,
      [
        this.promptCode,
        'Language Quality Judge Rubric',
        'Static rubric for the language-quality judge (see language-eval-judge-schema.md). ' +
          'The judge composes the per-language parameter block, persona and transcript around this text.',
      ],
    );
    await queryRunner.query(
      `INSERT INTO "prompts_versions" ("promptId", "version", "prompt", "createdBy", "updatedBy")
       SELECT p."id", 1, $1, 0, 0 FROM "prompts" p WHERE p."promptCode" = $2
       ON CONFLICT ("promptId", "version") DO NOTHING`,
      [this.rubric, this.promptCode],
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
