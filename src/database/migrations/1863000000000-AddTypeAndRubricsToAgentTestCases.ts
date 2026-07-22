import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits agent test cases into two types — "condition" and "full_session":
 *  - adds a `type` column (default 'condition' for new rows). Every EXISTING
 *    test case is migrated to 'full_session' per the product spec.
 *  - adds a `rubrics` JSONB column ([{criteria, scoringInstructions}], used by
 *    full-session tests only).
 *  - replaces the single `category` string with a `tags` JSONB string[]
 *    (existing category value is wrapped into a one-element tag array).
 *
 * `condition`/`test` (added in 1810) stay as the condition-test fields.
 */
export class AddTypeAndRubricsToAgentTestCases1863000000000 implements MigrationInterface {
  name = 'AddTypeAndRubricsToAgentTestCases1863000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. type — new rows default to 'condition'; migrate all existing rows to
    //    'full_session'.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "type" character varying NOT NULL DEFAULT 'condition'`,
    );
    await queryRunner.query(
      `UPDATE "agent_test_cases" SET "type" = 'full_session'`,
    );

    // 2. rubrics — nullable JSONB list; only full-session tests populate it.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "rubrics" jsonb`,
    );

    // 3. tags — JSONB string[] replacing the single `category` string.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "tags" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `UPDATE "agent_test_cases"
       SET "tags" = jsonb_build_array("category")
       WHERE "category" IS NOT NULL AND btrim("category") <> ''`,
    );

    // 4. Drop the old single-value category column.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "category"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse in the opposite order — restore category (NOT NULL) from the
    // first tag, then drop the new columns.
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ADD COLUMN "category" character varying`,
    );
    await queryRunner.query(
      `UPDATE "agent_test_cases" SET "category" = COALESCE("tags"->>0, '')`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" ALTER COLUMN "category" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "tags"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "rubrics"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_test_cases" DROP COLUMN "type"`,
    );
  }
}
