import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports the per-learner completion lookup behind the "already completed"
 * indicator on the scenario catalog
 * (ScenarioSessionRepository.getCompletionsForUser): every query filters
 * `counselorId` = the requester and `scenarioId` IN <the catalog page>.
 *
 * Only a single-column ("counselorId") index existed, which leaves the
 * scenarioId set to a heap filter over that learner's entire session history.
 * The existing index is left in place — dropping it is a separate decision.
 *
 * Plain CREATE INDEX, not CONCURRENTLY: TypeORM runs each migration inside a
 * transaction, and CONCURRENTLY cannot run in one.
 */
export class AddScenarioSessionsUserScenarioIndex1889000000000 implements MigrationInterface {
  name = 'AddScenarioSessionsUserScenarioIndex1889000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scenario_sessions_counselor_scenario" ON "scenario_sessions" ("counselorId", "scenarioId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_scenario_sessions_counselor_scenario"`,
    );
  }
}
