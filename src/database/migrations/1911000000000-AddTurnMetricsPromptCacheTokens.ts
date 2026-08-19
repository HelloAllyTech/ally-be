import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurnMetricsPromptCacheTokens1911000000000 implements MigrationInterface {
  name = 'AddTurnMetricsPromptCacheTokens1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "promptTokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "cachedTokens" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "cachedTokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "promptTokens"`,
    );
  }
}
