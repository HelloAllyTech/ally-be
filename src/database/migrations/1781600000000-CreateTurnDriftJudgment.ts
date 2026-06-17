import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates turn_drift_judgment — one row per AI-client turn per judge run,
 * holding the conversation-drift judge's per-turn output plus denormalized
 * slice dimensions for the analytics dashboard. See drift-metrics-spec.md and
 * the TurnDriftJudgment entity for field semantics.
 */
export class CreateTurnDriftJudgment1781600000000 implements MigrationInterface {
  name = 'CreateTurnDriftJudgment1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "turn_drift_judgment" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioSessionId" uuid, ` +
        `"turnIndex" integer NOT NULL, ` +
        `"coherence" character varying, ` +
        `"topicLabel" character varying, ` +
        `"inCharacter" boolean, ` +
        `"counselorUtteranceGarbled" character varying, ` +
        `"sttErrorType" character varying, ` +
        `"aiReplyFailureMode" character varying, ` +
        `"rootAttribution" character varying, ` +
        `"reasoning" text, ` +
        `"userText" text, ` +
        `"aiText" text, ` +
        `"language" character varying, ` +
        `"scenarioId" integer, ` +
        `"llmModel" character varying, ` +
        `"llmProvider" character varying, ` +
        `"promptVersion" character varying, ` +
        `"occurredAt" TIMESTAMP, ` +
        `"judgeModel" character varying NOT NULL, ` +
        `"judgePromptVersion" character varying NOT NULL DEFAULT 'v1', ` +
        `"metadata" jsonb, ` +
        `CONSTRAINT "PK_turn_drift_judgment" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "turn_drift_judgment_session_turn_judge_uq" UNIQUE ` +
        `("scenarioSessionId", "turnIndex", "judgeModel", "judgePromptVersion"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "turn_drift_judgment_session_id_idx" ON "turn_drift_judgment" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "turn_drift_judgment_occurred_at_idx" ON "turn_drift_judgment" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "turn_drift_judgment_language_idx" ON "turn_drift_judgment" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "turn_drift_judgment_scenario_id_idx" ON "turn_drift_judgment" ("scenarioId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."turn_drift_judgment_scenario_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."turn_drift_judgment_language_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."turn_drift_judgment_occurred_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."turn_drift_judgment_session_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "turn_drift_judgment"`);
  }
}
