import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSecondsInScenarioSessionMessages1757534758756 implements MigrationInterface {
  name = 'AddSecondsInScenarioSessionMessages1757534758756';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_messages" ADD "startSeconds" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_messages" ADD "endSeconds" double precision`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_messages" DROP COLUMN "endSeconds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_messages" DROP COLUMN "startSeconds"`,
    );
  }
}
