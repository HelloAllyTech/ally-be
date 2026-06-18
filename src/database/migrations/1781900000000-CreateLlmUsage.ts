import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `llm_usage` fact table (one row per LLM call) behind the
 * super-admin token-consumption analytics. Mirrors the
 * scenario_session_turn_metrics shape but `tenant_id` is NULLABLE here —
 * most usage events (autofill / translation / drift-judge) are tenantless and
 * these analytics are platform-wide (see LlmUsage entity comment).
 */
export class CreateLlmUsage1781900000000 implements MigrationInterface {
  name = 'CreateLlmUsage1781900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "llm_usage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "occurredAt" TIMESTAMP NOT NULL, "provider" character varying NOT NULL, "model" character varying NOT NULL, "task" character varying NOT NULL, "promptTokens" integer NOT NULL DEFAULT '0', "completionTokens" integer NOT NULL DEFAULT '0', "totalTokens" integer NOT NULL DEFAULT '0', "cachedTokens" integer, "env" character varying, "tenant_id" character varying, "scenarioSessionId" uuid, "roomId" character varying, "metadata" jsonb, CONSTRAINT "PK_llm_usage_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "llm_usage_occurred_at_idx" ON "llm_usage" ("occurredAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "llm_usage_model_idx" ON "llm_usage" ("model") `,
    );
    await queryRunner.query(
      `CREATE INDEX "llm_usage_task_idx" ON "llm_usage" ("task") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."llm_usage_task_idx"`);
    await queryRunner.query(`DROP INDEX "public"."llm_usage_model_idx"`);
    await queryRunner.query(`DROP INDEX "public"."llm_usage_occurred_at_idx"`);
    await queryRunner.query(`DROP TABLE "llm_usage"`);
  }
}
