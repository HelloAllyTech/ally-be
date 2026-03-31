import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranslationsToTriggerWarnings1774980224954 implements MigrationInterface {
  name = 'AddTranslationsToTriggerWarnings1774980224954';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trigger_warnings" ADD "translations" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trigger_warnings" DROP COLUMN "translations"`,
    );
  }
}
