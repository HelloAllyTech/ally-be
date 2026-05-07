import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportMarkdownToScenarioReports1777700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" ADD COLUMN IF NOT EXISTS "reportMarkdown" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" DROP COLUMN IF EXISTS "reportMarkdown"`,
    );
  }
}
