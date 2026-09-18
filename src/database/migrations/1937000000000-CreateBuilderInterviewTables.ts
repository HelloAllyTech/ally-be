import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder — the interview half of the schema.
 *
 * Six tables:
 *  - `builder_sessions` / `builder_messages` — the PRD interview conversation,
 *    with the atomic `lastMessageSeq` counter that keeps message seq gapless
 *    (the character_interview_* pattern).
 *  - `builder_prd_docs` / `builder_prd_versions` — the living PRD: one mutable
 *    draft plus an append-only snapshot per mutation, so "did the agent or the
 *    admin change this requirement?" stays answerable.
 *  - `builder_repo_maps` — Repo Knowledge Packs, the condensed per-repo
 *    context the interviewer reads instead of paging real files.
 *  - `builder_lessons` — cross-session memory from build retrospectives.
 *
 * Hand-written SQL with varchar + CHECK constraints rather than Postgres
 * enums, per the bug_findings precedent: TypeORM cannot express the CHECKs, so
 * `migration:generate` against these tables would propose dropping them.
 * Never run it here.
 *
 * The build half (runs, events, questions, PRs, reports) lands in a later
 * migration; nothing here depends on it existing.
 */
export class CreateBuilderInterviewTables1937000000000 implements MigrationInterface {
  name = 'CreateBuilderInterviewTables1937000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "builder_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(200) NOT NULL DEFAULT 'New build',
        "slug" character varying(80) NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'INTERVIEWING',
        "currentStage" character varying(16),
        "repos" jsonb,
        "engine" character varying(40) NOT NULL DEFAULT 'claude-code',
        "model" character varying(80),
        "lastMessageSeq" integer NOT NULL DEFAULT 0,
        "budgetUsd" numeric(10,4),
        "totalCostUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "runnerMinutes" integer NOT NULL DEFAULT 0,
        "error" text,
        "tenant_id" character varying,
        "metadata" jsonb,
        "createdBy" integer NOT NULL,
        "updatedBy" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_builder_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_sessions_status" CHECK ("status" IN (
          'INTERVIEWING', 'PRD_READY', 'BUILDING', 'WAITING_FOR_INPUT',
          'COMPLETED', 'FAILED', 'CANCELLED'
        )),
        CONSTRAINT "CHK_builder_sessions_stage" CHECK ("currentStage" IS NULL OR "currentStage" IN (
          'SETUP', 'PLANNING', 'CODING', 'TESTING', 'VERIFYING',
          'E2E_VERIFY', 'OPENING_PRS', 'REPORTING', 'DONE'
        ))
      )`,
    );
    // Unique across soft-deleted rows too: the branch a deleted session pushed
    // still exists on the remote, so reusing its slug would push onto
    // someone else's history.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_sessions_slug" ON "builder_sessions" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_sessions_created_by" ON "builder_sessions" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_sessions_status" ON "builder_sessions" ("status") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_sessions_tenant_id" ON "builder_sessions" ("tenant_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "role" character varying(12) NOT NULL,
        "content" text,
        "toolCalls" jsonb,
        "toolResults" jsonb,
        "metadata" jsonb,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_messages_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_messages_role" CHECK ("role" IN ('user', 'assistant'))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_messages_session_seq" ON "builder_messages" ("sessionId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_builder_messages_session_id" ON "builder_messages" ("sessionId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_prd_docs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "draft" jsonb NOT NULL,
        "versionNumber" integer NOT NULL DEFAULT 0,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_prd_docs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_prd_docs_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_prd_docs_session_id" ON "builder_prd_docs" ("sessionId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_prd_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "docId" uuid NOT NULL,
        "versionNumber" integer NOT NULL,
        "content" jsonb NOT NULL,
        "author" character varying(10) NOT NULL,
        "changeSummary" text,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_prd_versions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_prd_versions_doc" FOREIGN KEY ("docId")
          REFERENCES "builder_prd_docs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_prd_versions_author" CHECK ("author" IN ('agent', 'admin'))
      )`,
    );
    // The unique index is what makes the concurrent-writer retry in
    // BuilderPrdService.persistDraftMutation correct: a lost race fails on
    // this constraint and is retried rather than silently overwriting.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_prd_versions_doc_version" ON "builder_prd_versions" ("docId", "versionNumber")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_repo_maps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repo" character varying(80) NOT NULL,
        "commitSha" character varying(60),
        "mapMd" text NOT NULL,
        "stats" jsonb,
        "generatedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_repo_maps_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_builder_repo_maps_repo" ON "builder_repo_maps" ("repo")`,
    );

    await queryRunner.query(
      `CREATE TABLE "builder_lessons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid,
        "repo" character varying(80),
        "category" character varying(16) NOT NULL,
        "lesson" text NOT NULL,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_lessons_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_lessons_category" CHECK ("category" IN (
          'gotcha', 'convention', 'estimate', 'process'
        ))
      )`,
    );
    // No FK to builder_sessions on purpose: a lesson outlives the session that
    // learned it — that is the entire point of the table.
    await queryRunner.query(
      `CREATE INDEX "idx_builder_lessons_repo" ON "builder_lessons" ("repo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_lessons"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_repo_maps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_prd_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_prd_docs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_sessions"`);
  }
}
