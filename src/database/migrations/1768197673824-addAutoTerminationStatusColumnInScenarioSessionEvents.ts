import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoTerminationStatusColumnInScenarioSessionEvents1768197673824
  implements MigrationInterface
{
  name = 'AddAutoTerminationStatusColumnInScenarioSessionEvents1768197673824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" ADD "autoTerminationStatus" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" DROP COLUMN "autoTerminationStatus"`,
    );
  }
}
