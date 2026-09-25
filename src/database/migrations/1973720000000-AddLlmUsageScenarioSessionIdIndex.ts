import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index `llm_usage."scenarioSessionId"`.
 *
 * The roleplay session-cost chart joins every session in a window to its usage
 * rows, and the per-session cost endpoint looks one session's rows up directly.
 * Neither had an index to use — `llm_usage` was only ever read by time, task
 * or model — so both scanned the whole table. Most rows are tenantless
 * platform spend with a NULL session id, so the index is also small.
 */
export class AddLlmUsageScenarioSessionIdIndex1973720000000 implements MigrationInterface {
  name = 'AddLlmUsageScenarioSessionIdIndex1973720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "llm_usage_scenario_session_id_idx" ON "llm_usage" ("scenarioSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "llm_usage_scenario_session_id_idx"`,
    );
  }
}
