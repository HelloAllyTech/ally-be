import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The findings list wants to show which CLI/model actually ran a bug's most
 * recent session ("Claude · claude-sonnet-5" / "Gemini · gemini-2.5-pro").
 * Neither was ever recorded anywhere: the model is resolved independently
 * inside the CI workflow at runtime (`GET pipeline/models`), not by ally-be
 * at dispatch, so there was nothing to read it back from. The CI workflow now
 * reports it here right after resolving it — see `POST runs/:id/model`.
 * Nullable and never backfilled: a run closed
 * before this migration, or one whose workflow failed before reaching that
 * step, has no way to know what it used.
 */
export class AddBugHuntRunEngineAndModel1970000200000 implements MigrationInterface {
  name = 'AddBugHuntRunEngineAndModel1970000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs"
        ADD COLUMN "engine" character varying,
        ADD COLUMN "model" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs"
        DROP COLUMN "model",
        DROP COLUMN "engine"`,
    );
  }
}
