import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feedback-groundedness judge storage: one row per judged feedback claim.
 *
 * Closes the last gap in the Weak Performing Metrics set. Feedback delivery and
 * score discrimination were already measurable; whether the feedback was TRUE
 * of the session was not measured at all, and it is the failure counsellors
 * described as most harmful.
 *
 * Mirrors language_error_annotations: per-unit rows, enum verdicts and
 * booleans, no scalar scores. Every rate is computed at read time, so a
 * definition can change without re-judging a year of feedback.
 */
export class CreateFeedbackClaimJudgment1903000000000 implements MigrationInterface {
  name = 'CreateFeedbackClaimJudgment1903000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feedback_claim_judgment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "scenarioSessionId" uuid NOT NULL,
        "claimKind" character varying NOT NULL,
        "claimIndex" integer NOT NULL,
        "verdict" character varying NOT NULL,
        "quotesTranscript" boolean,
        "quoteIsAccurate" boolean,
        "claimText" text,
        "reasoning" text,
        "language" character varying,
        "scenarioId" integer,
        "scenarioVersionId" uuid,
        "llmModel" character varying,
        "occurredAt" TIMESTAMP,
        "judgeModel" character varying NOT NULL,
        "judgePromptVersion" character varying NOT NULL DEFAULT 'v1',
        "metadata" jsonb,
        CONSTRAINT "PK_feedback_claim_judgment" PRIMARY KEY ("id")
      )
    `);

    // Lets a re-judge under a new rubric coexist with prior runs instead of
    // overwriting them, and makes the backfill idempotent: re-issuing an
    // interrupted run skips whatever already landed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "feedback_claim_judgment_claim_judge_uq"
        ON "feedback_claim_judgment"
        ("scenarioSessionId", "claimKind", "claimIndex", "judgeModel", "judgePromptVersion")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "feedback_claim_judgment_session_id_idx"
        ON "feedback_claim_judgment" ("scenarioSessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "feedback_claim_judgment_occurred_at_idx"
        ON "feedback_claim_judgment" ("occurredAt")
    `);
    // The dashboard's headline cut is "unsupported + contradicted per 100
    // claims" over a window, so verdict leads this index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "feedback_claim_judgment_verdict_idx"
        ON "feedback_claim_judgment" ("verdict", "occurredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feedback_claim_judgment"`);
  }
}
