import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sharpen the STT Coherence Guard boundary to reduce false positives on
 * coherent, on-topic counseling statements (observed in Hindi report runs).
 * Adds an explicit "a coherent, on-topic counseling statement is NOT a
 * violation" clause. The detection methodology + few-shot live in the agent's
 * dedicated coherence classifier prompt; this is the editable boundary spec.
 */
export class SharpenSttCoherenceGuardBoundary1781222400000 implements MigrationInterface {
  name = 'SharpenSttCoherenceGuardBoundary1781222400000';

  private readonly guardrailName = 'STT Coherence Guard';

  private readonly newHelperDialogue =
    "Only trigger when the counselor's last utterance is unusable because of a " +
    'speech-to-text failure: (a) phonetically garbled or non-words, (b) semantically ' +
    'incoherent with no recoverable intent, or (c) coherent words that are abruptly and ' +
    'completely unrelated to the ongoing conversation in a way that reads as a likely ' +
    'mistranscription. A coherent, grammatically valid, on-topic counseling statement is ' +
    'NOT a violation, even if it is emotional, reflective, supportive, validating, or a ' +
    'question. Do NOT trigger for: a legitimate topic change or tangent, a terse-but-valid ' +
    'reply, Hinglish or code-switching, emotional or backchannel utterances, disfluency or ' +
    'self-correction, or an utterance that is mostly clear with one odd word. When unsure, ' +
    'do NOT trigger.';

  private readonly oldHelperDialogue =
    "Trigger when the counselor's last utterance is (a) phonetically garbled or non-words, " +
    '(b) semantically incoherent with no recoverable intent, or (c) coherent words that are ' +
    'abruptly and completely unrelated to the ongoing conversation in a way that reads as a likely ' +
    'mistranscription. Do NOT trigger for: a legitimate topic change or tangent, a terse-but-valid ' +
    'reply, Hinglish or code-switching, emotional or backchannel utterances, disfluency or ' +
    'self-correction, or an utterance that is mostly clear with one odd word. When unsure, do NOT trigger.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "conversational_guardrails"
       SET "helperDialogue" = $1
       WHERE "kind" = 'SYSTEM' AND "name" = $2`,
      [this.newHelperDialogue, this.guardrailName],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "conversational_guardrails"
       SET "helperDialogue" = $1
       WHERE "kind" = 'SYSTEM' AND "name" = $2`,
      [this.oldHelperDialogue, this.guardrailName],
    );
  }
}
