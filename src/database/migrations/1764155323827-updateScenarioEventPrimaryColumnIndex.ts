import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateScenarioEventPrimaryColumnIndex1764155323827
  implements MigrationInterface
{
  name = 'UpdateScenarioEventPrimaryColumnIndex1764155323827';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP CONSTRAINT "PK_451d8fbb4b158b0fbdb67b4bb42"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD CONSTRAINT "PK_0ad11b3d9d2757cd37b0af375cd" PRIMARY KEY ("scenarioId", "eventId", "autoTerminationStatus")`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ALTER COLUMN "autoTerminationStatus" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ALTER COLUMN "autoTerminationStatus" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP CONSTRAINT "PK_0ad11b3d9d2757cd37b0af375cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD CONSTRAINT "PK_451d8fbb4b158b0fbdb67b4bb42" PRIMARY KEY ("scenarioId", "eventId")`,
    );
  }
}
