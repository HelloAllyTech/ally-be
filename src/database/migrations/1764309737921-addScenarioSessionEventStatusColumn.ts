import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionEventStatusColumn1764309737921
  implements MigrationInterface
{
  name = 'AddScenarioSessionEventStatusColumn1764309737921';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the column with default value
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "eventStatus" character varying NOT NULL DEFAULT 'IN_PROGRESS'`,
    );
    await queryRunner.query(
      `UPDATE "scenario_sessions" SET "eventStatus" = 'IN_PROGRESS' WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `UPDATE "scenario_sessions" SET "eventStatus" = 'COMPLETED' WHERE "status" = 'ENDED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "eventStatus"`,
    );
  }
}
