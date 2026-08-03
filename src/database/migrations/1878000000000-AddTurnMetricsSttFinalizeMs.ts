import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurnMetricsSttFinalizeMs1878000000000 implements MigrationInterface {
  name = 'AddTurnMetricsSttFinalizeMs1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "sttFinalizeMs" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "sttFinalizeMs"`,
    );
  }
}
