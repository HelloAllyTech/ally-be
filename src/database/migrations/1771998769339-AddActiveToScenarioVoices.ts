import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveToScenarioVoices1771998769339 implements MigrationInterface {
  name = 'AddActiveToScenarioVoices1771998769339';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_voices" ADD "active" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_voices" DROP COLUMN "active"`,
    );
  }
}
