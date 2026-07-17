import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `scenario_session_lifecycle_events` — an append-only log of a
 * session's infrastructure milestones (room created, agent dispatched/joined,
 * participant joined, recording started, room finished). Powers the per-session
 * timeline in the super-admin roleplay session-logs view; an absent
 * AGENT_JOINED row makes "the agent never joined" incidents visible in-product.
 *
 * Standalone (no tenant_id / soft-delete): correlated to a session by
 * `scenarioSessionId` only. Indexed on (scenarioSessionId, occurredAt) for the
 * per-session, time-ordered read.
 */
export class CreateScenarioSessionLifecycleEvents1822000000000 implements MigrationInterface {
  name = 'CreateScenarioSessionLifecycleEvents1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scenario_session_lifecycle_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scenarioSessionId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "detail" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scenario_session_lifecycle_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ssle_session_occurred"
      ON "scenario_session_lifecycle_events" ("scenarioSessionId", "occurredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ssle_session_occurred"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "scenario_session_lifecycle_events"`,
    );
  }
}
