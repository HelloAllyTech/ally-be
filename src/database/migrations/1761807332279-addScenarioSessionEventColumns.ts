import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionEventColumns1761807332279
  implements MigrationInterface
{
  name = 'AddScenarioSessionEventColumns1761807332279';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" ADD "score" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" ADD "emoji" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" ADD "message" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" DROP COLUMN "message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" DROP COLUMN "emoji"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" DROP COLUMN "score"`,
    );
  }
}
