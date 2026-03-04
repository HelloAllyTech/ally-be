import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioReportsMetadata1772534326789 implements MigrationInterface {
  name = 'AddScenarioReportsMetadata1772534326789';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" ADD "metadata" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" DROP COLUMN "metadata"`,
    );
  }
}
