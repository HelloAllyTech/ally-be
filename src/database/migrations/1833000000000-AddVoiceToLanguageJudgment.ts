import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalizes the session's TTS voice onto language_judgment_sessions so the
 * language dashboard can compare round-trip WER across voices — the TTS
 * experiment axis (voice is what round-trip WER isolates). Consistent with the
 * other denormalized slice dims already on the row (language, llmModel, …).
 *
 * Populated by the judge at write time; historical rows fill in on re-judge.
 */
export class AddVoiceToLanguageJudgment1833000000000 implements MigrationInterface {
  name = 'AddVoiceToLanguageJudgment1833000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" ADD COLUMN IF NOT EXISTS "voiceId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" ADD COLUMN IF NOT EXISTS "voiceName" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" DROP COLUMN IF EXISTS "voiceName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" DROP COLUMN IF EXISTS "voiceId"`,
    );
  }
}
