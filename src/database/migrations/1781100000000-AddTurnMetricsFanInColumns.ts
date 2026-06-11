import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurnMetricsFanInColumns1781100000000 implements MigrationInterface {
  name = 'AddTurnMetricsFanInColumns1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "processEventsMs" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "behaviorsMs" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "behaviorsMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "processEventsMs"`,
    );
  }
}
