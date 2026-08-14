import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which agent test cases a session had no occasion to demonstrate.
 *
 * Agent test cases are configured globally (no scenario or tenant scoping), so
 * every session was scored against every goal and `compositeScore` was a mean
 * that included goals the conversation never exercised. The judge now marks
 * those, and the composite is computed over the applicable ones only.
 *
 * Nullable with no backfill: rows judged before this shipped have no
 * applicability data and are read as "all goals applicable", i.e. exactly the
 * behaviour they were scored under.
 */
export class AddNotApplicableGoalsToScenarioSessionDetails1898000000000 implements MigrationInterface {
  name = 'AddNotApplicableGoalsToScenarioSessionDetails1898000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details" ADD "notApplicableGoals" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details" DROP COLUMN "notApplicableGoals"`,
    );
  }
}
