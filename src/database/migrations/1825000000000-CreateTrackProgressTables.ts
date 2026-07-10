import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track 2.0 learner progress tables:
 *  - track_enrollments     — one row per (track, user); progress root with
 *                            completedItems counter and completedAt stamp.
 *  - track_item_progress   — one row per (enrollment, item), ALL created
 *                            upfront at enrollment (first UNLOCKED, rest
 *                            LOCKED). caseSessionId links CASE items to their
 *                            underlying case session; meta JSONB carries
 *                            video/article state (maxWatchedPct, read stamps).
 *  - track_quiz_attempts   — per-attempt answers + grading JSONB, scorePct,
 *                            passed, status SUBMITTED|PENDING_GRADING|GRADED.
 *  - track_journal_entries — one row per (progress row, prompt); null
 *                            submittedAt = draft (mirrors the
 *                            scenario_session_reflection_prompt_response
 *                            pattern).
 *
 * Loose-FK convention: bare columns + partial indexes, no DB constraints.
 */
export class CreateTrackProgressTables1825000000000 implements MigrationInterface {
  name = 'CreateTrackProgressTables1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "track_enrollments" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackId" uuid NOT NULL, "userId" integer NOT NULL, "tenantId" uuid, "startedAt" TIMESTAMP, "completedAt" TIMESTAMP, "completedItems" integer NOT NULL DEFAULT 0, "lastActivityAt" TIMESTAMP, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_enrollments_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_enrollments_track_user" ON "track_enrollments" ("trackId", "userId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_enrollments_user_id" ON "track_enrollments" ("userId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_item_progress" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackEnrollmentId" uuid NOT NULL, "trackItemId" uuid NOT NULL, "userId" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'LOCKED', "startedAt" TIMESTAMP, "completedAt" TIMESTAMP, "score" numeric, "attemptCount" integer NOT NULL DEFAULT 0, "caseSessionId" uuid, "meta" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_item_progress_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_item_progress_enrollment_item" ON "track_item_progress" ("trackEnrollmentId", "trackItemId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_item_progress_track_item_id" ON "track_item_progress" ("trackItemId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_item_progress_case_session_id" ON "track_item_progress" ("caseSessionId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_quiz_attempts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackItemProgressId" uuid NOT NULL, "trackItemId" uuid NOT NULL, "userId" integer NOT NULL, "attemptNumber" integer NOT NULL, "answers" jsonb NOT NULL, "grading" jsonb, "scorePct" numeric, "passed" boolean, "status" character varying NOT NULL DEFAULT 'SUBMITTED', "submittedAt" TIMESTAMP, "gradedAt" TIMESTAMP, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_quiz_attempts_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_quiz_attempts_progress_id" ON "track_quiz_attempts" ("trackItemProgressId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_journal_entries" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackItemProgressId" uuid NOT NULL, "trackItemId" uuid NOT NULL, "userId" integer NOT NULL, "promptId" character varying NOT NULL, "response" text, "submittedAt" TIMESTAMP, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_journal_entries_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_journal_entries_progress_prompt" ON "track_journal_entries" ("trackItemProgressId", "promptId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_journal_entries_progress_prompt"`,
    );
    await queryRunner.query(`DROP TABLE "track_journal_entries"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_quiz_attempts_progress_id"`,
    );
    await queryRunner.query(`DROP TABLE "track_quiz_attempts"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_item_progress_case_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_item_progress_track_item_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_item_progress_enrollment_item"`,
    );
    await queryRunner.query(`DROP TABLE "track_item_progress"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_enrollments_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_enrollments_track_user"`,
    );
    await queryRunner.query(`DROP TABLE "track_enrollments"`);
  }
}
