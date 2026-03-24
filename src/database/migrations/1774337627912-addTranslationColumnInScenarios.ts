import { MigrationInterface, QueryRunner } from 'typeorm';

export class addTranslationColumnInScenarios1774337627912 implements MigrationInterface {
  name = 'addTranslationColumnInScenarios1774337627912';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" ADD "translations" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "translations"`,
    );
  }
}
