import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the "Optimisation Goals" feature to "Agent Test Cases":
 *  - renames the `optimisation_goals` table (and its PK constraint) to `agent_test_cases`
 *  - adds two new nullable text columns per test case: `condition` and `test`
 *  - migrates the scenario metadata key `optimisationGoalIds` -> `agentTestCaseIds`
 *    (rides in `scenarios.metadata` JSONB) so existing scenario -> test-case links survive.
 */
export class RenameOptimisationGoalsToAgentTestCases1810000000000 implements MigrationInterface {
  name = 'RenameOptimisationGoalsToAgentTestCases1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename the table + primary-key constraint.
    await queryRunner.query(
      `ALTER TABLE "optimisation_goals" RENAME TO "agent_test_cases"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" RENAME CONSTRAINT "PK_optimisation_goals_id" TO "PK_agent_test_cases_id"`,
    );

    // 2. Add the two new per-test-case fields.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "condition" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "test" text`,
    );

    // 3. Rename the JSONB metadata key on scenarios (optimisationGoalIds -> agentTestCaseIds).
    await queryRunner.query(
      `UPDATE "scenarios"
       SET "metadata" = ("metadata" - 'optimisationGoalIds')
         || jsonb_build_object('agentTestCaseIds', "metadata" -> 'optimisationGoalIds')
       WHERE "metadata" ? 'optimisationGoalIds'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in the opposite order.

    // 3. Restore the JSONB metadata key (agentTestCaseIds -> optimisationGoalIds).
    await queryRunner.query(
      `UPDATE "scenarios"
       SET "metadata" = ("metadata" - 'agentTestCaseIds')
         || jsonb_build_object('optimisationGoalIds', "metadata" -> 'agentTestCaseIds')
       WHERE "metadata" ? 'agentTestCaseIds'`,
    );

    // 2. Drop the added columns.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "test"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "condition"`,
    );

    // 1. Rename the constraint + table back.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" RENAME CONSTRAINT "PK_agent_test_cases_id" TO "PK_optimisation_goals_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" RENAME TO "optimisation_goals"`,
    );
  }
}
