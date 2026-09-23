import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pipeline telemetry for Bug Hunter: per-phase timings and per-lookup context
 * records — see `BugHuntPhaseTiming` and `BugHuntContextLookup`.
 *
 * Until now a run recorded what it did (`bug_hunt_events`) and what it cost
 * (`bug_hunt_runs.total*`), and nothing in between: not how long each phase
 * took, not how much context the agent was shown, not whether a fetch for
 * production logs came back empty. When a night went badly the CI log was the
 * only place to look. These two tables are the stage-level view.
 *
 * Both `phase` and `kind` are `character varying` with a CHECK constraint,
 * per repo convention. Hand-written SQL, never `migration:generate` — the
 * generator would propose dropping the constraints. Extending either enum
 * means redefining its constraint here AND adding to
 * `check-constraints-cover-enums.spec.ts`.
 *
 * No FK to `bug_hunt_runs`: this module's tables reference runs by bare uuid
 * throughout (see `bug_hunt_events.runId`), and telemetry must never be the
 * reason a run row cannot be cleaned up.
 */
export class CreateBugHuntTelemetry1971800000000 implements MigrationInterface {
  name = 'CreateBugHuntTelemetry1971800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bug_hunt_phases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "phase" character varying NOT NULL,
        "started_at" TIMESTAMP NOT NULL,
        "finished_at" TIMESTAMP,
        "duration_ms" integer,
        "summary" text,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunt_phases" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunt_phases_phase"
          CHECK ("phase" IN ('discover', 'verify', 'fix', 'close', 'reproduce', 'suite', 'pr'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_phases_run_id" ON "bug_hunt_phases" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_bug_hunt_phases_run_phase" ON "bug_hunt_phases" ("run_id", "phase")`,
    );

    await queryRunner.query(`
      CREATE TABLE "bug_hunt_context_lookups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" uuid NOT NULL,
        "kind" character varying NOT NULL,
        "item_count" integer NOT NULL DEFAULT 0,
        "chars" integer NOT NULL DEFAULT 0,
        "latency_ms" integer NOT NULL DEFAULT 0,
        "relevance" numeric(5,4),
        "used_count" integer,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunt_context_lookups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_bug_hunt_context_lookups_kind"
          CHECK ("kind" IN ('prod_logs', 'web_logs', 'reported_bugs', 'approved_findings', 'known_non_bugs', 'repo_map', 'memory'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_context_lookups_run_id" ON "bug_hunt_context_lookups" ("run_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bug_hunt_context_lookups_created_at" ON "bug_hunt_context_lookups" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bug_hunt_context_lookups"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bug_hunt_phases"`);
  }
}
