import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course Copilot — the admin agent that interviews a trainer, proposes a
 * course blueprint, builds a DRAFT Track 2.0 course from it, and edits it on
 * request. See docs/course-copilot.md.
 *
 * Four tables:
 *  - `course_copilot_sessions` — the conversation, its brief and blueprint,
 *    the bound course (`trackId`), the blueprint-id → track-id map, budget,
 *    and the atomic `lastMessageSeq` / `lastEventSeq` counters.
 *  - `course_copilot_messages` — the transcript (character_interview_messages
 *    shape).
 *  - `course_copilot_jobs` — one row per unit of build work, claimed by a
 *    conditional UPDATE so a build survives a deploy.
 *  - `course_copilot_events` — append-only progress log for the socket and
 *    the polling fallback.
 *
 * Hand-written SQL with varchar + CHECK constraints rather than Postgres
 * enums (the Builder precedent): `migration:generate` cannot express the
 * CHECKs and would propose dropping them. Every CHECK here is listed in
 * check-constraints-cover-enums.spec.ts against the enum it guards.
 */
export class CreateCourseCopilotTables1977700000000 implements MigrationInterface {
  name = 'CreateCourseCopilotTables1977700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "course_copilot_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(200) NOT NULL DEFAULT 'New course',
        "mode" character varying(16) NOT NULL DEFAULT 'CREATE',
        "status" character varying(24) NOT NULL DEFAULT 'INTERVIEWING',
        "trackId" uuid,
        "brief" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "blueprint" jsonb,
        "blueprintVersion" integer NOT NULL DEFAULT 0,
        "approvedBlueprint" jsonb,
        "trackIdMap" jsonb NOT NULL DEFAULT '{"sections":{},"items":{}}'::jsonb,
        "budgetUsd" numeric(10,2) NOT NULL,
        "generatedScenarioIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "generatedCaseIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "generatedCharacterIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "metadata" jsonb,
        "lastMessageSeq" integer NOT NULL DEFAULT 0,
        "lastEventSeq" integer NOT NULL DEFAULT 0,
        "tenant_id" character varying,
        "createdBy" integer NOT NULL,
        "updatedBy" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_course_copilot_sessions_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_copilot_sessions_track" FOREIGN KEY ("trackId")
          REFERENCES "tracks"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_course_copilot_sessions_mode" CHECK ("mode" IN ('CREATE', 'EDIT')),
        CONSTRAINT "CHK_course_copilot_sessions_status" CHECK ("status" IN (
          'INTERVIEWING', 'AWAITING_BLUEPRINT', 'BUILDING', 'BUILD_FAILED',
          'EDITING', 'ARCHIVED'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_sessions_created_by" ON "course_copilot_sessions" ("createdBy") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_sessions_track_id" ON "course_copilot_sessions" ("trackId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_sessions_status" ON "course_copilot_sessions" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "course_copilot_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "role" character varying(16) NOT NULL,
        "content" text,
        "toolCalls" jsonb,
        "toolResults" jsonb,
        "metadata" jsonb,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_copilot_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_copilot_messages_session" FOREIGN KEY ("sessionId")
          REFERENCES "course_copilot_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_course_copilot_messages_role" CHECK ("role" IN ('user', 'assistant'))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_course_copilot_messages_session_seq" ON "course_copilot_messages" ("sessionId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_messages_session_id" ON "course_copilot_messages" ("sessionId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "course_copilot_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "blueprintItemId" character varying(64),
        "dependsOn" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" character varying(16) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "input" jsonb NOT NULL,
        "result" jsonb,
        "error" text,
        "costUsd" numeric(10,4),
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "heartbeatAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_copilot_jobs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_copilot_jobs_session" FOREIGN KEY ("sessionId")
          REFERENCES "course_copilot_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_course_copilot_jobs_kind" CHECK ("kind" IN (
          'course_meta', 'article', 'quiz', 'journal', 'annotated_artifact',
          'game', 'video', 'roleplay_new', 'roleplay_ref', 'case_new',
          'case_ref', 'cover_image', 'article_image', 'course_review'
        )),
        CONSTRAINT "CHK_course_copilot_jobs_status" CHECK ("status" IN (
          'queued', 'running', 'done', 'failed', 'skipped', 'held'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_copilot_jobs_session_status" ON "course_copilot_jobs" ("sessionId", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "course_copilot_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "type" character varying(24) NOT NULL,
        "payload" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_copilot_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_copilot_events_session" FOREIGN KEY ("sessionId")
          REFERENCES "course_copilot_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_course_copilot_events_type" CHECK ("type" IN (
          'build_started', 'job_queued', 'job_started', 'job_progress',
          'job_done', 'job_failed', 'job_skipped', 'structure_written',
          'budget_hold', 'review_ready', 'build_finished', 'build_failed',
          'course_changed'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_course_copilot_events_session_seq" ON "course_copilot_events" ("sessionId", "seq")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "course_copilot_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_copilot_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_copilot_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_copilot_sessions"`);
  }
}
