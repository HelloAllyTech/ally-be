import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterScenarioEventsTable1761290996593
  implements MigrationInterface
{
  name = 'AlterScenarioEventsTable1761290996593';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "feedbackStatus" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "emoji" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "message" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "score" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "branchingStatus" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "branchInstruction" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "branchInstruction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "branchingStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "score"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "emoji"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "feedbackStatus"`,
    );
  }
}
