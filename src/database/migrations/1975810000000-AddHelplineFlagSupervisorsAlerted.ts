import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `helpline_risk_flags.supervisors_alerted` — how many supervisors the HIGH
 * flag's alert reached (docs/text-helpline.md §9.3), so the listener's banner
 * can say "your supervisor has been alerted" only when it is true.
 *
 * NULL = not applicable (ELEVATED, or a flag raised before this column);
 * 0 = HIGH but nobody could be alerted (no supervisor in the org, or the alert
 * failed); n = supervisors notified by this flag's alert or by the deduped
 * alert, within the last 10 minutes, that already covered the chat.
 */
export class AddHelplineFlagSupervisorsAlerted1975810000000 implements MigrationInterface {
  name = 'AddHelplineFlagSupervisorsAlerted1975810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" ADD COLUMN IF NOT EXISTS "supervisors_alerted" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" ADD CONSTRAINT "CHK_helpline_risk_flags_supervisors_alerted" CHECK ("supervisors_alerted" IS NULL OR "supervisors_alerted" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" DROP CONSTRAINT IF EXISTS "CHK_helpline_risk_flags_supervisors_alerted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "helpline_risk_flags" DROP COLUMN IF EXISTS "supervisors_alerted"`,
    );
  }
}
