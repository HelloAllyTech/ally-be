import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fact table for simulation START latency ("time to first word"): one row per
 * session, populated live by ally-ai-learn's `start_metrics` SQS message and
 * backfilled from transcripts (see the companion backfill migration). Mirrors
 * scenario_session_turn_metrics conventions (BaseEntity columns + occurredAt +
 * source + metadata jsonb; wide segment columns for a stacked breakdown chart).
 */
export class CreateScenarioSessionStartMetrics1809000000000 implements MigrationInterface {
  name = 'CreateScenarioSessionStartMetrics1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_start_metrics" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid, "roomId" character varying NOT NULL, "startLatencyMs" integer NOT NULL, "configureMs" integer, "initializeMs" integer, "connectMs" integer, "prepMs" integer, "openingPlayoutMs" integer, "scenarioId" integer, "language" character varying, "env" character varying, "occurredAt" TIMESTAMP, "source" character varying NOT NULL DEFAULT 'pipeline', "metadata" jsonb, CONSTRAINT "PK_scenario_session_start_metrics_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_start_metrics_scenario_id_idx" ON "scenario_session_start_metrics" ("scenarioId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_start_metrics_occurred_at_idx" ON "scenario_session_start_metrics" ("occurredAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_start_metrics_session_id_idx" ON "scenario_session_start_metrics" ("scenarioSessionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_start_metrics_session_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_start_metrics_occurred_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_start_metrics_scenario_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_start_metrics"`);
  }
}
