import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByAndLatestUpdatedByToScenarios1759922841662 implements MigrationInterface {
  name = 'AddCreatedByAndLatestUpdatedByToScenarios1759922841662';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" ADD "createdBy" integer`);
    await queryRunner.query(`ALTER TABLE "scenarios" ADD "updatedBy" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "updatedBy"`);
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "createdBy"`);
  }
}
