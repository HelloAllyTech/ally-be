import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCaseSessionItemIdToScenarioSessionTable1770355673556 implements MigrationInterface {
  name = 'AddCaseSessionItemIdToScenarioSessionTable1770355673556';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "caseSessionItemId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "caseSessionItemId"`,
    );
  }
}
