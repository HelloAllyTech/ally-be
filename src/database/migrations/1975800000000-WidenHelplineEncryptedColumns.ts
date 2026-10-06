import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Text helpline PHI is encrypted at rest (docs/text-helpline.md §4,
 * `HelplineContentCipher`). Ciphertext is `hlenc:v1:` + base64(iv ‖ tag ‖ data):
 * a 40-character display name in Devanagari (3 bytes a character) becomes about
 * 210 characters, so the three bounded text columns that now hold ciphertext
 * cannot keep their plaintext limits. They become `text`; the plaintext limits
 * (40 / 500 / 1,000 characters) stay enforced where the values are written.
 *
 * `helpline_messages.content` is already `text` and `helpline_chat_summaries.fields`
 * is `jsonb` (`{ "enc": … }`), so neither changes. No data is rewritten: rows
 * written before encryption stay readable as legacy plaintext and age out
 * through retention.
 */
export class WidenHelplineEncryptedColumns1975800000000 implements MigrationInterface {
  name = 'WidenHelplineEncryptedColumns1975800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "helpline_talkers" ALTER COLUMN "display_name" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" ALTER COLUMN "outcome_note" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_talker_feedback" ALTER COLUMN "comment" TYPE text`,
    );
  }

  /**
   * Restores the original types. Destructive by nature once encrypted values
   * exist: ciphertext does not fit and is truncated, i.e. unreadable afterwards.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "helpline_talker_feedback" ALTER COLUMN "comment" TYPE character varying(1000) USING left("comment", 1000)`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" ALTER COLUMN "outcome_note" TYPE character varying(500) USING left("outcome_note", 500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_talkers" ALTER COLUMN "display_name" TYPE character varying(40) USING left("display_name", 40)`,
    );
  }
}
