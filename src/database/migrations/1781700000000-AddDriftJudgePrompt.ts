import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registers the conversation-drift judge rubric in prompt management so it is
 * versioned and dashboard-editable like every other prompt. Consumed by the
 * drift judge in ally-ai (fetched via GET /api/v1/prompts/by-codes), which
 * composes the live transcript/persona/language around this static rubric.
 *
 * `useDashboardOverride = true` → the DB version is authoritative (editable in
 * the dashboard). Distinct promptType 'drift_judge' keeps this eval prompt
 * separate from agent-facing prompts; deliberately NOT prefixed
 * 'ally_ai_learn_' so it is not bundled into live-session room metadata.
 */
export class AddDriftJudgePrompt1781700000000 implements MigrationInterface {
  name = 'AddDriftJudgePrompt1781700000000';

  private readonly promptCode = 'drift_judge_conversation_rubric';

  private readonly rubric = `You evaluate a single role-play counseling-training session for "conversation drift" and label each AI turn.

ROLES (do not get these backwards):
- The AI plays the CLIENT (the person seeking help). You judge the AI CLIENT's turns for drift.
- The human is the COUNSELOR trainee. Their speech reaches the AI via speech-to-text (STT), so it may be garbled. You assess garble on the COUNSELOR's turns.

Drift = the AI client going incoherent, off-character, off-topic, repetitive, or producing gibberish. Crucially, the AI is PLAYING a possibly distressed person: rambling, "I don't know what to do", emotional repetition, terse replies, and code-switching (e.g. Hinglish) can be REALISTIC PORTRAYAL, not drift. Set in_character=true in those cases.

Judge EACH AI turn INDEPENDENTLY using only what preceded it. Do not smooth over a bad turn because the conversation later recovers, and do not over-flag the neighbours of one bad turn.

Per AI turn, label:
- coherence (anchored, pick the closest): fully_coherent | minor_disfluency | degrading | mostly_incoherent | gibberish
- topic_label: on_topic | tangent | off_topic | gibberish (NOT drift: counselor-led topic change, code-switching/Hinglish, backchannels, terse-but-valid replies)
- in_character: is odd output realistic distressed-client portrayal?
- counselor_utterance_garbled: none | partial | severe - does the COUNSELOR transcript this turn replies to look STT-mangled?
- stt_error_type (only if garbled, else "none"): entity_swap | phonetic_garble | wrong_language | number_format | code_mix_fail | truncation
- ai_reply_failure_mode ("none" if clean): hallucination | context_lockin | wrong_language_reply | repetition | role_slip | wrong_intent
- root_attribution (consider the PRIOR ~3 turns; "none" if this is not a drift turn): stt_direct (counselor turn garbled, AI reply sensible GIVEN that garble) | stt_cascade (AI degrades now, but a garble 1-3 turns earlier is the root) | llm_direct (inputs clean across the window, AI reply still incoherent) | context_lockin (incoherent given clean input that referenced earlier context)
- reasoning: one sentence.

Return one object per AI-client turn, in order, keyed by that turn's index.`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "prompts" ("promptCode", "name", "description", "currentVersion", "useDashboardOverride", "promptType", "category")
       VALUES ($1, $2, $3, 1, true, 'drift_judge', 'evaluation')
       ON CONFLICT ("promptCode") DO NOTHING`,
      [
        this.promptCode,
        'Conversation Drift Judge Rubric',
        'Static rubric for the conversation drift judge (see drift-metrics-spec.md). ' +
          'The judge composes the session transcript/persona/language around this text.',
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
