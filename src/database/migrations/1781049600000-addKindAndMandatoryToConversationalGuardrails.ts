import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKindAndMandatoryToConversationalGuardrails1781049600000 implements MigrationInterface {
  name = 'AddKindAndMandatoryToConversationalGuardrails1781049600000';

  private readonly systemGuardrailName = 'STT Coherence Guard';

  private readonly helperDialogue =
    "Trigger when the counselor's last utterance is (a) phonetically garbled or non-words, " +
    '(b) semantically incoherent with no recoverable intent, or (c) coherent words that are ' +
    'abruptly and completely unrelated to the ongoing conversation in a way that reads as a likely ' +
    'mistranscription. Do NOT trigger for: a legitimate topic change or tangent, a terse-but-valid ' +
    'reply, Hinglish or code-switching, emotional or backchannel utterances, disfluency or ' +
    'self-correction, or an utterance that is mostly clear with one odd word. When unsure, do NOT trigger.';

  private readonly actorDialogue =
    "You could not properly follow the counselor's last message - it was either unintelligible/garbled, " +
    'or it did not connect to the conversation in a way that suggests it may not have come through ' +
    "correctly. Stay in character and, in your own words, briefly tell them you didn't quite catch that " +
    'and ask them to repeat or rephrase. Do not attempt to answer, guess at, or act on the unclear ' +
    'content, and do not change the subject to follow it.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         CREATE TYPE "conversational_guardrails_kind_enum" AS ENUM ('USER', 'SYSTEM');
       EXCEPTION
         WHEN duplicate_object THEN null;
       END $$;`,
    );

    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails"
       ADD COLUMN IF NOT EXISTS "kind" "conversational_guardrails_kind_enum"
       NOT NULL DEFAULT 'USER'`,
    );

    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails"
       ADD COLUMN IF NOT EXISTS "mandatory" boolean NOT NULL DEFAULT false`,
    );

    // Seed the always-on STT Coherence Guard (idempotent, parameterized).
    await queryRunner.query(
      `INSERT INTO "conversational_guardrails"
         ("name", "helperDialogue", "actorDialogue", "active", "kind", "mandatory")
       SELECT $1::varchar, $2::varchar, $3::varchar, true, 'SYSTEM', true
       WHERE NOT EXISTS (
         SELECT 1 FROM "conversational_guardrails"
         WHERE "kind" = 'SYSTEM' AND "name" = $1::varchar
       )`,
      [this.systemGuardrailName, this.helperDialogue, this.actorDialogue],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "conversational_guardrails" WHERE "kind" = 'SYSTEM' AND "name" = $1`,
      [this.systemGuardrailName],
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" DROP COLUMN IF EXISTS "mandatory"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" DROP COLUMN IF EXISTS "kind"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "conversational_guardrails_kind_enum"`,
    );
  }
}
