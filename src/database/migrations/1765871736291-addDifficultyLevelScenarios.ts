import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDifficultyLevelScenarios1765871736291 implements MigrationInterface {
  name = 'AddDifficultyLevelScenarios1765871736291';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "difficultyLevel" character varying DEFAULT 'MEDIUM'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "difficultyLevel"`,
    );
  }
}
