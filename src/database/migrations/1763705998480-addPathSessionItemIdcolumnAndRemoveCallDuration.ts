import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPathSessionItemIdColumnAndRemoveCallDuration1763705998480
  implements MigrationInterface
{
  name = 'AddPathSessionItemIdColumnAndRemoveCallDuration1763705998480';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_path_session_items" DROP COLUMN "duration"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "scenarioPathSessionItemId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "scenarioPathSessionItemId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_path_session_items" ADD "duration" double precision`,
    );
  }
}
