import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the thinking-filler judge's two tables (see ally-ai's
 * `docs/filler-eval-judge-schema.md` and the entity files for field semantics).
 * Sibling of `1829000000000-CreateLanguageJudgment`, same shape:
 *
 * - filler_judgment_sessions — one row per session per judge run; the
 *   DENOMINATOR (fillersJudged) so sessions with zero findings still count in
 *   finding rates.
 * - filler_finding_annotations — one row per finding; most played fillers
 *   produce none.
 *
 * Why the feature needs its own eval at all: a thinking filler is the
 * character's first words after the learner stops, so `responseLatencyMs` is
 * measured to it. A filler that arrives instantly but sounds nothing like the
 * character improves every latency chart while making the roleplay worse. These
 * rows are the only place that failure becomes visible.
 */
export class CreateFillerJudgment1953000000000 implements MigrationInterface {
  name = 'CreateFillerJudgment1953000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "filler_judgment_sessions" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioSessionId" uuid NOT NULL, ` +
        `"fillersJudged" integer NOT NULL, ` +
        `"distinctPhraseRatio" double precision, ` +
        `"repeatedFillers" integer NOT NULL DEFAULT 0, ` +
        `"droppedAnnotations" integer NOT NULL DEFAULT 0, ` +
        `"language" character varying, ` +
        `"scenarioId" integer, ` +
        `"scenarioVersionId" uuid, ` +
        `"engine" character varying, ` +
        `"llmModel" character varying, ` +
        `"llmProvider" character varying, ` +
        `"voiceId" character varying, ` +
        `"voiceName" character varying, ` +
        `"promptVersion" character varying, ` +
        `"occurredAt" TIMESTAMP, ` +
        `"judgeModel" character varying NOT NULL, ` +
        `"judgePromptVersion" character varying NOT NULL DEFAULT 'v1', ` +
        `"metadata" jsonb, ` +
        `CONSTRAINT "PK_filler_judgment_sessions" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "filler_judgment_sessions_session_judge_uq" UNIQUE ` +
        `("scenarioSessionId", "judgeModel", "judgePromptVersion"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_judgment_sessions_session_id_idx" ` +
        `ON "filler_judgment_sessions" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_judgment_sessions_occurred_at_idx" ` +
        `ON "filler_judgment_sessions" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_judgment_sessions_language_idx" ` +
        `ON "filler_judgment_sessions" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_judgment_sessions_scenario_id_idx" ` +
        `ON "filler_judgment_sessions" ("scenarioId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "filler_finding_annotations" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"tenant_id" character varying NOT NULL, ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioSessionId" uuid NOT NULL, ` +
        `"sessionJudgmentId" uuid NOT NULL, ` +
        `"turnIndex" integer NOT NULL, ` +
        `"dimension" character varying NOT NULL, ` +
        `"category" character varying NOT NULL, ` +
        `"severity" character varying NOT NULL, ` +
        `"conditionedOut" boolean NOT NULL DEFAULT false, ` +
        `"evidenceQuote" text, ` +
        `"reasoning" text, ` +
        `"fillerText" text, ` +
        `"source" character varying, ` +
        `"fillerType" character varying, ` +
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
        `CONSTRAINT "PK_filler_finding_annotations" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_finding_annotations_session_id_idx" ` +
        `ON "filler_finding_annotations" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_finding_annotations_judgment_id_idx" ` +
        `ON "filler_finding_annotations" ("sessionJudgmentId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_finding_annotations_occurred_at_idx" ` +
        `ON "filler_finding_annotations" ("occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_finding_annotations_language_idx" ` +
        `ON "filler_finding_annotations" ("language")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "filler_finding_annotations_dimension_idx" ` +
        `ON "filler_finding_annotations" ("dimension")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "filler_finding_annotations"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "filler_judgment_sessions"`);
  }
}
