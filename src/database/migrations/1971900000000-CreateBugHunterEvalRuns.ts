import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stored replays of a Bug Hunter prompt over the labelled eval set — see
 * `BugHunterEvalRun`. The eval set itself is not a table: it is derived on
 * request from settled `bug_findings` rows (`GET pipeline/eval-set`) and
 * snapshotted to a file by the replay script, so the golden set is versioned
 * where the prompt is.
 *
 * `prompt_kind` is `character varying` with a CHECK constraint, per repo
 * convention. Hand-written SQL, never `migration:generate`. Extending the enum
 * means redefining the constraint here AND adding to
 * `check-constraints-cover-enums.spec.ts`.
 */
export class CreateBugHunterEvalRuns1971900000000 implements MigrationInterface {
  name = 'CreateBugHunterEvalRuns1971900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bug_hunter_eval_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repo" text,
        "prompt_kind" character varying NOT NULL,
        "prompt_hash" character varying(64) NOT NULL,
        "model" character varying NOT NULL,
        "set_hash" character varying(64),
        "item_count" integer NOT NULL,
        "answered_count" integer NOT NULL,
        "agreement" numeric(5,4),
        "real_recall" numeric(5,4),
        "not_a_bug_recall" numeric(5,4),
        "per_source" jsonb,
        "per_label_source" jsonb,
        "calibration" jsonb,
        "cost_usd" numeric(10,4),
        "duration_ms" integer,
        "notes" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunter_eval_runs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunter_eval_runs_prompt_kind"
          CHECK ("prompt_kind" IN ('verifier'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunter_eval_runs_created_at" ON "bug_hunter_eval_runs" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunter_eval_runs_prompt_hash" ON "bug_hunter_eval_runs" ("prompt_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bug_hunter_eval_runs"`);
  }
}
