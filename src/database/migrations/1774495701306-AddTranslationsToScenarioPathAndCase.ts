import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTranslationsToScenarioPathAndCase1774495701306 implements MigrationInterface {
  name = 'AddTranslationsToScenarioPathAndCase1774495701306';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_paths" ADD "translations" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "cases" ADD "translations" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cases" DROP COLUMN "translations"`);
    await queryRunner.query(
      `ALTER TABLE "scenario_paths" DROP COLUMN "translations"`,
    );
  }
}
