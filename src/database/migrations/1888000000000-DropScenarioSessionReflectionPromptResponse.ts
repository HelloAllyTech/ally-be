import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deeper Reflection is deprecated: the tab is gone from the learner's
 * post-session summary and the endpoints that backed it have been removed, so
 * this table has no readers or writers left.
 *
 * DESTRUCTIVE. Dropping the table discards every reflection response learners
 * have written. `down()` recreates the table's shape so the schema can be
 * rolled back, but it CANNOT restore the rows — take a dump of
 * `scenario_session_reflection_prompt_response` before running this anywhere
 * the data matters.
 */
export class DropScenarioSessionReflectionPromptResponse1888000000000 implements MigrationInterface {
  name = 'DropScenarioSessionReflectionPromptResponse1888000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The unique index is owned by the table and goes with it.
    await queryRunner.query(
      `DROP TABLE IF EXISTS "scenario_session_reflection_prompt_response"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Mirrors the shape as of migration 1779721000000, which widened
    // "scenarioSessionId" from varchar to uuid. Recreated empty by design.
    await queryRunner.query(
      `CREATE TABLE "scenario_session_reflection_prompt_response" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "promptId" uuid NOT NULL, "response" text, CONSTRAINT "PK_556083eb840186b3f8c96a5015e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_reflection_prompt_response_idx" ON "scenario_session_reflection_prompt_response" ("scenarioSessionId", "promptId") `,
    );
  }
}
