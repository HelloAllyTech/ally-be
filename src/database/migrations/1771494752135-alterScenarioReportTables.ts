import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterScenarioReportTables1771494752135 implements MigrationInterface {
  name = 'AlterScenarioReportTables1771494752135';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" DROP COLUMN "score"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_report_transcripts" RENAME COLUMN "sender" TO "role"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_report_transcripts" DROP COLUMN "endSeconds"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_report_transcripts" ADD "endSeconds" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_report_transcripts" RENAME COLUMN "role" TO "sender"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" ADD "score" integer`,
    );
  }
}
