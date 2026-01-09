import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetectionConfigColumnInScenarioEvents1767966859892
  implements MigrationInterface
{
  name = 'AddDetectionConfigColumnInScenarioEvents1767966859892';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "detectionConfig" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "detectionConfig"`,
    );
  }
}
