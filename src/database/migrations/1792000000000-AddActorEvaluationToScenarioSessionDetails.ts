import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-real-session actor-evaluation storage to `scenario_session_details`.
 *
 * Real roleplay sessions previously had only a single cumulative `score` on
 * `scenario_sessions` (from the event webhook). This adds the multi-metric
 * LLM-judge output (the same shape `scenario_reports.metrics` uses, but for a
 * REAL session scored against the superadmin-configured optimisation goals):
 *  - `metrics`            — goal/metric name -> 0-100 score (jsonb)
 *  - `compositeScore`     — round(mean(metrics)) (int)
 *  - `evaluationMarkdown` — human-readable judge feedback (text)
 *  - `evaluationStatus`   — IN_PROGRESS | COMPLETED | FAILED (varchar)
 *  - `evaluatedAt`        — when the evaluation completed (timestamp)
 *
 * 1:1 with the session (this table is already 1:1), so no new table is needed.
 */
export class AddActorEvaluationToScenarioSessionDetails1792000000000 implements MigrationInterface {
  name = 'AddActorEvaluationToScenarioSessionDetails1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details"
        ADD COLUMN "metrics" jsonb,
        ADD COLUMN "compositeScore" integer,
        ADD COLUMN "evaluationMarkdown" text,
        ADD COLUMN "evaluationStatus" character varying,
        ADD COLUMN "evaluatedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details"
        DROP COLUMN "evaluatedAt",
        DROP COLUMN "evaluationStatus",
        DROP COLUMN "evaluationMarkdown",
        DROP COLUMN "compositeScore",
        DROP COLUMN "metrics"`,
    );
  }
}
