import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoTerminationStatusColumn1762929644441
  implements MigrationInterface
{
  name = 'AddAutoTerminationStatusColumn1762929644441';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "autoTerminationStatus" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "autoTerminationStatus"`,
    );
  }
}
