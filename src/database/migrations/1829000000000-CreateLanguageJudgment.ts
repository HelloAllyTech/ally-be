import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the language-quality judge's two tables (see
 * language-eval-judge-schema.md and the entity files for field semantics):
 *
 * - language_judgment_sessions — one row per session per judge run; the
 *   DENOMINATOR (turnsJudged / turnsGarbled) so zero-error sessions count in
 *   weighted error rates.
 * - language_error_annotations — one row per categorized error; a clean
 *   session has none.
 *
 * Single write path, two read surfaces: Roleplay Session Logs reads these rows
 * per session; the analytics dashboard aggregates the same rows.
 */
export class CreateLanguageJudgment1829000000000 implements MigrationInterface {
  name = 'CreateLanguageJudgment1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "language_judgment_sessions" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioSessionId" uuid NOT NULL, ` +
        `"turnsJudged" integer NOT NULL, ` +
        `"turnsGarbled" integer NOT NULL DEFAULT 0, ` +
        `"droppedAnnotations" integer NOT NULL DEFAULT 0, ` +
        `"scriptFidelityPct" double precision, ` +
        `"language" character varying, ` +
        `"scenarioId" integer, ` +
        `"scenarioVersionId" uuid, ` +
        `"engine" character varying, ` +
        `"llmModel" character varying, ` +
        `"llmProvider" character varying, ` +
        `"promptVersion" character varying, ` +
        `"occurredAt" TIMESTAMP, ` +
        `"judgeModel" character varying NOT NULL, ` +
        `"judgePromptVersion" character varying NOT NULL DEFAULT 'v1', ` +
        `"metadata" jsonb, ` +
        `CONSTRAINT "PK_language_judgment_sessions" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "language_judgment_sessions_session_judge_uq" UNIQUE ` +
        `("scenarioSessionId", "judgeModel", "judgePromptVersion"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_judgment_sessions_session_id_idx" ON "language_judgment_sessions" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_judgment_sessions_occurred_at_idx" ON "language_judgment_sessions" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_judgment_sessions_language_idx" ON "language_judgment_sessions" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_judgment_sessions_scenario_id_idx" ON "language_judgment_sessions" ("scenarioId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "language_error_annotations" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioSessionId" uuid NOT NULL, ` +
        `"sessionJudgmentId" uuid NOT NULL, ` +
        `"turnIndex" integer NOT NULL, ` +
        `"layer" character varying NOT NULL, ` +
        `"dimension" character varying NOT NULL, ` +
        `"category" character varying NOT NULL, ` +
        `"severity" character varying NOT NULL, ` +
        `"isolationBasis" character varying, ` +
        `"inputGarbled" character varying, ` +
        `"conditionedOut" boolean NOT NULL DEFAULT false, ` +
        `"evidenceQuote" text, ` +
        `"reasoning" text, ` +
        `"userText" text, ` +
        `"aiText" text, ` +
        `"language" character varying, ` +
        `"scenarioId" integer, ` +
        `"scenarioVersionId" uuid, ` +
        `"engine" character varying, ` +
        `"llmModel" character varying, ` +
        `"llmProvider" character varying, ` +
        `"promptVersion" character varying, ` +
        `"occurredAt" TIMESTAMP, ` +
        `"judgeModel" character varying NOT NULL, ` +
        `"judgePromptVersion" character varying NOT NULL DEFAULT 'v1', ` +
        `"metadata" jsonb, ` +
        `CONSTRAINT "PK_language_error_annotations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_error_annotations_session_id_idx" ON "language_error_annotations" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_error_annotations_judgment_id_idx" ON "language_error_annotations" ("sessionJudgmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_error_annotations_occurred_at_idx" ON "language_error_annotations" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_error_annotations_language_idx" ON "language_error_annotations" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "language_error_annotations_dimension_idx" ON "language_error_annotations" ("dimension")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_error_annotations_dimension_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_error_annotations_language_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_error_annotations_occurred_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_error_annotations_judgment_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_error_annotations_session_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "language_error_annotations"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_judgment_sessions_scenario_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_judgment_sessions_language_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_judgment_sessions_occurred_at_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."language_judgment_sessions_session_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "language_judgment_sessions"`,
    );
  }
}
