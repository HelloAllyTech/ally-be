import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bug Hunter's tools and memory (2026-10-13):
 *
 * 1. `bug_hunter_feature_maps` — one card per user-facing feature, written by
 *    the weekly read-only map run and read by every study (see
 *    BugHunterFeatureMap).
 * 2. `bug_hunt_runs.trigger` may hold 'feature_map', the map run itself.
 * 3. `bug_hunt_context_lookups.kind` may hold 'probe', 'precedents' and
 *    'feature_map', so every probe call and knowledge lookup a run makes is
 *    recorded against it like the notebook and log lookups already are.
 *
 * Both CHECKs are restated in full: a CHECK cannot be appended to.
 */
export class AddBugHunterToolsAndFeatureMaps1976100000000 implements MigrationInterface {
  name = 'AddBugHunterToolsAndFeatureMaps1976100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bug_hunter_feature_maps" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repo" character varying(40) NOT NULL,
        "slug" character varying(80) NOT NULL,
        "title" character varying(200) NOT NULL,
        "summary" text NOT NULL,
        "entry_points" jsonb NOT NULL DEFAULT '[]',
        "endpoints" jsonb NOT NULL DEFAULT '[]',
        "data_homes" jsonb NOT NULL DEFAULT '[]',
        "written_by" text,
        "related_repos" jsonb NOT NULL DEFAULT '[]',
        "gotchas" jsonb NOT NULL DEFAULT '[]',
        "source_sha" character varying(64),
        "run_id" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bug_hunter_feature_maps" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_bug_hunter_feature_maps_repo_slug" ON "bug_hunter_feature_maps" ("repo", "slug")`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix', 'verify_findings', 'pr_review', 'feature_map'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_context_lookups" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_context_lookups_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_context_lookups" ADD CONSTRAINT "CHK_bug_hunt_context_lookups_kind"
         CHECK ("kind" IN ('prod_logs', 'web_logs', 'reported_bugs', 'approved_findings', 'known_non_bugs', 'repo_map', 'memory', 'probe', 'precedents', 'feature_map'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_hunt_context_lookups" WHERE "kind" IN ('probe', 'precedents', 'feature_map')`,
    );
    await queryRunner.query(
      `DELETE FROM "bug_hunt_runs" WHERE "trigger" = 'feature_map'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix', 'verify_findings', 'pr_review'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_context_lookups" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_context_lookups_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_context_lookups" ADD CONSTRAINT "CHK_bug_hunt_context_lookups_kind"
         CHECK ("kind" IN ('prod_logs', 'web_logs', 'reported_bugs', 'approved_findings', 'known_non_bugs', 'repo_map', 'memory'))`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "bug_hunter_feature_maps"`);
  }
}
