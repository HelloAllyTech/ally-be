import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioSessionTurnMetrics1781068861553 implements MigrationInterface {
  name = 'CreateScenarioSessionTurnMetrics1781068861553';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_turn_metrics" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid, "roomId" character varying NOT NULL, "turnIndex" integer NOT NULL, "invocationId" character varying, "responseLatencyMs" integer NOT NULL, "eouDelayMs" integer, "llmTtftMs" integer, "ttsTtfbMs" integer, "orchestrationMs" integer, "llmResponseMs" integer, "prosodyMs" integer, "branchingMs" integer, "knowledgeRetrievalMs" integer, "scenarioId" integer, "language" character varying, "llmModel" character varying, "env" character varying, "responseChars" integer, "eventsDetected" integer NOT NULL DEFAULT '0', "prosodySkipped" boolean NOT NULL DEFAULT false, "llmTimedOut" boolean NOT NULL DEFAULT false, "interrupted" boolean NOT NULL DEFAULT false, "occurredAt" TIMESTAMP, "metadata" jsonb, CONSTRAINT "PK_86d9a8f49fd460ca8cd41e66dc3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_turn_metrics_scenario_id_idx" ON "scenario_session_turn_metrics" ("scenarioId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_turn_metrics_occurred_at_idx" ON "scenario_session_turn_metrics" ("occurredAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_turn_metrics_session_id_idx" ON "scenario_session_turn_metrics" ("scenarioSessionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_turn_metrics_session_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_turn_metrics_occurred_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_turn_metrics_scenario_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_turn_metrics"`);
  }
}
