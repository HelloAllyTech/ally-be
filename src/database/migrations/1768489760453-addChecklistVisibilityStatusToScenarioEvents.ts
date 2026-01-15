import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChecklistVisibilityStatusToScenarioEvents1768489760453 implements MigrationInterface {
  name = 'AddChecklistVisibilityStatusToScenarioEvents1768489760453';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "checklistVisibilityStatus" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "checklistVisibilityStatus"`,
    );
  }
}
