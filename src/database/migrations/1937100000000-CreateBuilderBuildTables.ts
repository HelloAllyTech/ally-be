import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder — the build half of the schema (the interview half is
 * `1937000000000`).
 *
 * Seven tables:
 *  - `builder_build_runs` — one dispatched GitHub Actions run. Several per
 *    session: the first `build`, a `resume` for each pause, plus retries.
 *  - `builder_build_events` — the append-only live transcript, at engine
 *    granularity (every tool call and file edit) as well as milestones.
 *  - `builder_questions` — mid-build pauses. `group_id` lets one pause carry
 *    several questions, so an ambiguous plan costs one stop rather than four.
 *  - `builder_pull_requests` — unique per (session, repo); a resume updates
 *    the same PR rather than opening another.
 *  - `builder_reports` — the agent's own account of its work.
 *  - `builder_settings` — singleton kill switch and caps, **off by default**.
 *  - `builder_notifications` — what happened while you were elsewhere.
 *
 * Hand-written SQL with varchar + CHECK rather than Postgres enums, per the
 * bug_findings precedent: TypeORM cannot express these CHECKs, so
 * `migration:generate` against these tables proposes dropping them.
 */
export class CreateBuilderBuildTables1937100000000
  implements MigrationInterface
{
  name = 'CreateBuilderBuildTables1937100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "builder_build_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "sequence" integer NOT NULL,
        "mode" character varying(10) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'QUEUED',
        "resumeOfRunId" uuid,
        "engine" character varying(40) NOT NULL,
        "model" character varying(80) NOT NULL,
        "branchSlug" character varying(80) NOT NULL,
        "branches" jsonb,
        "githubRunId" bigint,
        "githubRunUrl" text,
        "dispatchedAt" TIMESTAMP NOT NULL,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "lastEventSeq" integer NOT NULL DEFAULT 0,
        "cost" jsonb,
        "costUsd" numeric(10,4),
        "runnerMinutes" integer,
        "error" text,
        "createdBy" integer,
        "cancelledBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_build_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_build_runs_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_build_runs_mode" CHECK ("mode" IN ('build', 'resume')),
        CONSTRAINT "CHK_builder_build_runs_status" CHECK ("status" IN (
          'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED',
          'TIMED_OUT', 'WAITING_FOR_INPUT'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_build_runs_session_id" ON "builder_build_runs" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_build_runs_status" ON "builder_build_runs" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_build_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "sessionId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "stage" character varying(16),
        "type" character varying(20) NOT NULL,
        "payload" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_build_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_build_events_run" FOREIGN KEY ("runId")
          REFERENCES "builder_build_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_build_events_type" CHECK ("type" IN (
          'text', 'tool_call', 'tool_result', 'file_edit', 'todo',
          'test_output', 'stage_change', 'plan', 'verification', 'question',
          'e2e_evidence', 'e2e_skipped', 'pr_opened', 'report', 'cost',
          'error', 'done'
        )),
        CONSTRAINT "CHK_builder_build_events_stage" CHECK ("stage" IS NULL OR "stage" IN (
          'SETUP', 'PLANNING', 'CODING', 'TESTING', 'VERIFYING',
          'E2E_VERIFY', 'OPENING_PRS', 'REPORTING', 'DONE'
        ))
      )`,
    );
    // The unique (runId, seq) is what makes the forwarder's batched appends
    // safe to retry: a redelivered batch collides instead of duplicating.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_build_events_run_seq" ON "builder_build_events" ("runId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_build_events_session" ON "builder_build_events" ("sessionId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_questions" (
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
      `CREATE INDEX "idx_builder_questions_session" ON "builder_questions" ("sessionId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_questions_group" ON "builder_questions" ("groupId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_pull_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "runId" uuid,
        "repo" character varying(80) NOT NULL,
        "branch" character varying(200) NOT NULL,
        "prNumber" integer NOT NULL,
        "prUrl" text NOT NULL,
        "title" text,
        "ciStatus" character varying(20),
        "merged" boolean NOT NULL DEFAULT false,
        "mergedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_pull_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_pull_requests_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE
      )`,
    );
    // Unique per repo: a resume run pushes more commits to the same branch,
    // which updates the existing PR rather than opening a second one.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_pull_requests_session_repo" ON "builder_pull_requests" ("sessionId", "repo")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_reports" (
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
          'run_report', 'session_report', 'retrospective'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_reports_session" ON "builder_reports" ("sessionId", "type")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "enabled" boolean NOT NULL DEFAULT false,
        "maxConcurrentBuilds" integer NOT NULL DEFAULT 3,
        "defaultBudgetUsd" numeric(10,4),
        "defaultEngine" character varying(40),
        "defaultModel" character varying(80),
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_settings_id" PRIMARY KEY ("id")
      )`,
    );
    // Seed the singleton disabled. An agent that writes code and opens PRs
    // must not become reachable just because a migration ran.
    await queryRunner.query(
      `INSERT INTO "builder_settings" ("enabled") VALUES (false)`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "adminId" integer NOT NULL,
        "sessionId" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "message" text NOT NULL,
        "readAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_notifications_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_notifications_kind" CHECK ("kind" IN (
          'question_pending', 'build_completed', 'build_failed',
          'prs_opened', 'budget_reached'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_notifications_admin_unread" ON "builder_notifications" ("adminId", "readAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_pull_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_questions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_build_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_build_runs"`);
  }
}
