import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The memory flywheel: a curated lesson set, an exemplar bank, and the
 * counters that let evidence decide what stays.
 *
 * **Lessons become a curated set rather than an append-only log.** Every build
 * appended up to ten retrospective bullets and retrieval took the newest
 * twenty, so the same trap learned five times became five rows competing for
 * one fixed context budget — and after twenty builds the earliest lessons were
 * unreachable however good they were. `status` lets raw harvest land as
 * `candidate` for a consolidation pass to place; `sourceCount` counts how many
 * builds independently found the same thing; `timesApplied` /
 * `timesContradicted` turn "which lessons are earning their slot" into a
 * question with an answer.
 *
 * **`repos` fixes multi-repo attribution.** A lesson from a two-repo build lost
 * its attribution entirely and became platform-wide, because only a single-repo
 * build had one `repo` to record. Backfilled from the old column.
 *
 * **`builder_exemplars` is new**: finished builds with how they turned out.
 * Lessons capture what an agent believed in the minutes after finishing;
 * whether the PR merged, was closed unmerged, or needed four fix runs is
 * knowable only later and is the part that says which approaches work.
 *
 * Existing rows are backfilled to `active`, so a deployment does not silently
 * empty the lesson set the moment this runs.
 */
export class BuilderMemoryFlywheel1939300000000 implements MigrationInterface {
  name = 'BuilderMemoryFlywheel1939300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Lessons v2 ────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_lessons"
         ADD COLUMN IF NOT EXISTS "repos" jsonb,
         ADD COLUMN IF NOT EXISTS "status" character varying(16) NOT NULL DEFAULT 'candidate',
         ADD COLUMN IF NOT EXISTS "pinned" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "sourceCount" integer NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS "sourceSessionIds" jsonb,
         ADD COLUMN IF NOT EXISTS "timesApplied" integer NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "timesContradicted" integer NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "mergedIntoId" uuid,
         ADD COLUMN IF NOT EXISTS "tags" jsonb,
         ADD COLUMN IF NOT EXISTS "lastAppliedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_lessons"
         ADD CONSTRAINT "CHK_builder_lessons_status"
         CHECK ("status" IN ('candidate', 'active', 'merged', 'retired'))`,
    );
    // Everything already in the table was being fed to prompts, so it is
    // active by definition — defaulting it to `candidate` would empty the
    // lesson set until the curator next ran.
    await queryRunner.query(
      `UPDATE "builder_lessons"
          SET "status" = 'active',
              "repos" = CASE WHEN "repo" IS NULL THEN NULL
                             ELSE jsonb_build_array("repo") END,
              "sourceSessionIds" = CASE WHEN "sessionId" IS NULL THEN NULL
                                        ELSE jsonb_build_array("sessionId"::text) END`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_lessons_status"
         ON "builder_lessons" ("status")`,
    );

    // ── Frozen exemplar selection per session ─────────────────────────────
    //
    // Frozen because the context block it feeds lives inside the prompt-cached
    // prefix: a selection that changed between turns would invalidate the
    // cache on every turn, costing far more than the examples are worth.
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD COLUMN IF NOT EXISTS "contextExemplarIds" jsonb,
         ADD COLUMN IF NOT EXISTS "contextExemplarRepos" jsonb`,
    );

    // ── The exemplar bank ─────────────────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_exemplars" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "repos" jsonb,
        "prdSnapshot" jsonb,
        "planMd" text,
        "diffstat" jsonb,
        "outcome" character varying(24) NOT NULL DEFAULT 'open',
        "fixRunCount" integer NOT NULL DEFAULT 0,
        "reviewCommentCount" integer NOT NULL DEFAULT 0,
        "ciFailureCount" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(10,4),
        "runnerMinutes" integer,
        "timeToMergeHours" numeric(10,2),
        "failureTags" jsonb,
        "summaryMd" text,
        "lastOutcomeSyncAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_exemplars" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_exemplars_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_exemplars_outcome" CHECK ("outcome" IN (
          'open', 'merged', 'partially_merged', 'closed_unmerged',
          'failed', 'cancelled'
        ))
      )`,
    );
    // One exemplar per session: archiving is called from run settling, which
    // can fire more than once for one session (a retry, a reconcile catching
    // up), and a second row would double-count the build in every metric.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_exemplars_session"
         ON "builder_exemplars" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_exemplars_outcome"
         ON "builder_exemplars" ("outcome")`,
    );

    // ── Reports: the post-mortem type ─────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "builder_reports" DROP CONSTRAINT IF EXISTS "CHK_builder_reports_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_reports"
         ADD CONSTRAINT "CHK_builder_reports_type"
         CHECK ("type" IN (
           'run_report', 'session_report', 'retrospective', 'post_mortem'
         ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "builder_reports" WHERE "type" = 'post_mortem'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_reports" DROP CONSTRAINT IF EXISTS "CHK_builder_reports_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_reports"
         ADD CONSTRAINT "CHK_builder_reports_type"
         CHECK ("type" IN ('run_report', 'session_report', 'retrospective'))`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "builder_exemplars"`);
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         DROP COLUMN IF EXISTS "contextExemplarIds",
         DROP COLUMN IF EXISTS "contextExemplarRepos"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_lessons_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_lessons" DROP CONSTRAINT IF EXISTS "CHK_builder_lessons_status"`,
    );
    // Merged rows were folded into another lesson and their text is a
    // duplicate; retired ones were deliberately removed from the set. Neither
    // should come back as a live lesson when the status column goes away.
    await queryRunner.query(
      `DELETE FROM "builder_lessons" WHERE "status" IN ('merged', 'retired')`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_lessons"
         DROP COLUMN IF EXISTS "repos",
         DROP COLUMN IF EXISTS "status",
         DROP COLUMN IF EXISTS "pinned",
         DROP COLUMN IF EXISTS "sourceCount",
         DROP COLUMN IF EXISTS "sourceSessionIds",
         DROP COLUMN IF EXISTS "timesApplied",
         DROP COLUMN IF EXISTS "timesContradicted",
         DROP COLUMN IF EXISTS "mergedIntoId",
         DROP COLUMN IF EXISTS "tags",
         DROP COLUMN IF EXISTS "lastAppliedAt"`,
    );
  }
}
