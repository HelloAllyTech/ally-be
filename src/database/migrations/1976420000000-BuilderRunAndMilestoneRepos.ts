import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One repo per build.
 *
 * A session whose approved design spans ally-be, ally-web and ally-mobile used
 * to build all three in one run: three toolchains, three test suites and three
 * sets of pre-existing failures in one loop, which is where the 2026-10-13
 * local runs spent their time. It now builds them as a chain of milestones,
 * one repo each, backend first — the epic chain that already starts the next
 * milestone when a run succeeds.
 *
 * `builder_milestones.repos` is the repos a milestone builds (null: all of the
 * session's, as epic milestones always have). `builder_build_runs.repos` is
 * what a run was dispatched with; the prompts and the design scope served to
 * the run are cut to it. It was a workflow input only, so the server rendered
 * every run's prompt for the whole session.
 */
export class BuilderRunAndMilestoneRepos1976420000000 implements MigrationInterface {
  name = 'BuilderRunAndMilestoneRepos1976420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_milestones" ADD COLUMN IF NOT EXISTS "repos" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS "repos" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "repos"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_milestones" DROP COLUMN IF EXISTS "repos"`,
    );
  }
}
