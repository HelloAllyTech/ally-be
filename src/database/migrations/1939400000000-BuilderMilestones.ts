import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Epic mode: a large PRD becomes an ordered series of independently shippable
 * milestones, each landing as its own stacked pull request.
 *
 * Milestones are rows on the session rather than child sessions. A child
 * session would duplicate the interview, the PRD and the readiness rubric —
 * and, worse, every session owns a unique `slug` naming the branches it
 * pushes, so five child sessions would scatter one feature across five
 * unrelated branch families. Here the slug stays one family:
 * `builder/<slug>-m1`, `-m2`, and so on.
 *
 * **The pull-request unique index has to widen.** It was `(sessionId, repo)`,
 * on the reasoning that a resume pushes more commits to the same branch and so
 * updates one PR rather than opening a second. That still holds within a
 * milestone, but an epic opens one PR per repo *per milestone* — so the key
 * becomes `(sessionId, repo, branch)`. Without this, milestone 2 would
 * overwrite milestone 1's row and the first pull request would vanish from the
 * session view while remaining open on GitHub.
 */
export class BuilderMilestones1939400000000 implements MigrationInterface {
  name = 'BuilderMilestones1939400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_milestones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "position" integer NOT NULL,
        "title" character varying(200) NOT NULL,
        "summaryMd" text,
        "requirementIds" jsonb,
        "technicalNotesMd" text,
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "branchSlug" character varying(100) NOT NULL,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_milestones" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_milestones_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_milestones_status" CHECK ("status" IN (
          'PENDING', 'BUILDING', 'WAITING_FOR_INPUT', 'COMPLETED',
          'FAILED', 'SKIPPED'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_milestones_session"
         ON "builder_milestones" ("sessionId")`,
    );
    // Position is the build order and the branch suffix, so two milestones
    // sharing one would mean two slices pushing to the same branch.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_milestones_position"
         ON "builder_milestones" ("sessionId", "position")`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD COLUMN IF NOT EXISTS "milestoneId" uuid`,
    );

    // ── The PR key widens to include the branch ───────────────────────────
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_pull_requests_session_repo"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_pull_requests_session_repo_branch"
         ON "builder_pull_requests" ("sessionId", "repo", "branch")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Narrowing the key back can only succeed if no session has two PRs in one
    // repo — which is exactly what epic mode creates. Drop the extras, keeping
    // the earliest per (session, repo), or the index cannot be rebuilt.
    await queryRunner.query(
      `DELETE FROM "builder_pull_requests" a
        USING "builder_pull_requests" b
        WHERE a."sessionId" = b."sessionId"
          AND a."repo" = b."repo"
          AND a."createdAt" > b."createdAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_pull_requests_session_repo_branch"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_pull_requests_session_repo"
         ON "builder_pull_requests" ("sessionId", "repo")`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "milestoneId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_milestones"`);
  }
}
