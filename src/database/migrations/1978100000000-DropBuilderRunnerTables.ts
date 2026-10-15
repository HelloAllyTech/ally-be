import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the four tables only the old runner build path wrote.
 *
 * Builder builds through GitHub issues now (opencode in each repo's Actions),
 * and the runner that remains drafts technical designs only. Nothing writes
 * these tables any more, and nothing reads them:
 *  - `builder_steers` — corrections relayed to a running build;
 *  - `builder_questions` — a runner build pausing to ask a person;
 *  - `builder_attempts` — one row per coding attempt (the tier "bandit");
 *  - `builder_reports` — the runner's own run/session reports.
 *
 * No other table references them. `down()` recreates the empty tables in
 * their last shape; the rows themselves are not recoverable from here.
 */
export class DropBuilderRunnerTables1978100000000 implements MigrationInterface {
  name = 'DropBuilderRunnerTables1978100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_steers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_reports"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "runId" uuid,
        "type" character varying(20) NOT NULL,
        "contentMd" text NOT NULL,
        "metrics" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_reports_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_reports_type" CHECK ("type" IN (
          'run_report', 'session_report', 'retrospective', 'post_mortem'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_reports_session" ON "builder_reports" ("sessionId", "type")`,
    );

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
        "gateTrusted" boolean NOT NULL DEFAULT true,
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
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_builder_attempts_run_phase_attempt"
         ON "builder_attempts" ("runId", "phase", "attempt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_attempts_model"
         ON "builder_attempts" ("model", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "groupId" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        "question" jsonb NOT NULL,
        "answer" jsonb,
        "answerText" text,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "answeredAt" TIMESTAMP,
        "answeredBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_questions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_questions_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_questions_status" CHECK ("status" IN (
          'pending', 'answered', 'superseded'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_questions_session" ON "builder_questions" ("sessionId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_questions_group" ON "builder_questions" ("groupId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_steers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "runId" uuid,
        "note" text NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "deliveredAt" TIMESTAMP,
        "deliveredToRunId" uuid,
        "deliveredAtPhase" character varying(32),
        "createdByUserId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_steers_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_steers_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_builder_steers_run" FOREIGN KEY ("runId")
          REFERENCES "builder_build_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_builder_steers_delivered_run" FOREIGN KEY ("deliveredToRunId")
          REFERENCES "builder_build_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_builder_steers_status" CHECK ("status" IN (
          'pending', 'delivered', 'superseded'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_steers_session"
         ON "builder_steers" ("sessionId", "status")`,
    );
  }
}
