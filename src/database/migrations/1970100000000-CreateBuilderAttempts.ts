import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_attempts` — one row per coding attempt, and the decision context
 * that produced it.
 *
 * This is the dataset a model-selection policy learns from. Routing a coding
 * agent by cost is a contextual-bandit problem: observe features, pick an arm
 * (a model), collect a reward. The expensive ingredient is normally the
 * reward — most routers buy preference data or pay a judge. Builder gets a
 * deterministic one free, because its gate is jest and eslint on a clean tree
 * diffed against a baseline, so "did that attempt work" is a fact rather than
 * a model's opinion of itself.
 *
 * ## Why a table and not a query
 *
 * Most of the numbers already exist — per-phase cost lives in
 * `builder_build_runs.cost.phases` keyed `code-2`, gate verdicts arrive as
 * `gate_result` events. Two things make querying them insufficient rather than
 * merely awkward.
 *
 * The join is by convention: correlating a `code-N` cost key to the Nth gate
 * event means parsing keys and trusting event ordering, which is the kind of
 * query that is written once, subtly wrong, and never checked.
 *
 * More importantly **the context is destroyed**. Requirement count and
 * technical-plan length are read off the PRD draft, and the draft is mutable —
 * the interview keeps editing it, and an epic rewrites it. By the time anyone
 * queries, the features that actually drove the decision are gone and have
 * been replaced by whatever the PRD says now. A policy trained on that is
 * learning from features its decisions were never conditioned on. Those
 * columns therefore live on the run row (frozen at dispatch, added alongside
 * this table), and this table holds what varies per attempt.
 *
 * ## Two rewards, on different clocks
 *
 * `gatePassed` is the immediate one, known within minutes.
 *
 * The one that matters more is delayed: whether the work merged, was reverted,
 * needed fix runs, or drew review comments — which the outcome sweep already
 * categorises per session. That reward belongs to **one** attempt, the one
 * whose diff survived, which is why `producedFinalDiff` is recorded rather
 * than inferred. Crediting a merge to every attempt in the run would reward
 * the cheap tier that failed twice for work the expensive tier finished.
 *
 * Without that second signal a cost optimisation cannot be falsified: a model
 * that clears the gate and writes code reverted a week later is not cheaper,
 * and the gate alone will never say so.
 *
 * No tenant column: Builder is a platform-admin agent, like its sibling tables.
 */
export class CreateBuilderAttempts1970100000000 implements MigrationInterface {
  name = 'CreateBuilderAttempts1970100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The decision context, frozen at dispatch. Nullable because runs that
    // predate this recorded none, and a zero would read as "a build with no
    // requirements" rather than "we did not look".
    for (const column of [
      '"requirementCount" integer',
      '"repoCount" integer',
      '"technicalPlanLength" integer',
      '"effort" character varying(8)',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS ${column}`,
      );
    }

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "sessionId" uuid NOT NULL,
        "attempt" integer NOT NULL,
        "phase" character varying(16) NOT NULL DEFAULT 'code',
        "engine" character varying(40),
        "model" character varying(80) NOT NULL,
        "ladderIndex" integer,
        "escalated" boolean NOT NULL DEFAULT false,
        "gatePassed" boolean,
        "newFailureCount" integer,
        "verifyVerdict" character varying(8),
        "producedFinalDiff" boolean NOT NULL DEFAULT false,
        "costUsd" numeric(10,4),
        "durationMs" integer,
        "numTurns" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_attempts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_attempts_run" FOREIGN KEY ("runId")
          REFERENCES "builder_build_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_builder_attempts_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_attempts_verdict" CHECK (
          "verifyVerdict" IS NULL OR "verifyVerdict" IN ('pass', 'fail')
        )
      )`,
    );

    // The runner re-reports a phase on retry, so writes upsert by this key
    // rather than accumulating duplicate arms for one decision.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_builder_attempts_run_phase_attempt"
         ON "builder_attempts" ("runId", "phase", "attempt")`,
    );
    // The policy query: every attempt on one arm, newest first.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_attempts_model"
         ON "builder_attempts" ("model", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_attempts"`);
    for (const column of [
      'requirementCount',
      'repoCount',
      'technicalPlanLength',
      'effort',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
