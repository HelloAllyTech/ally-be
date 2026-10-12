import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop Builder's engine selection: `builder_sessions.engine` and
 * `builder_settings.defaultEngine`.
 *
 * opencode is the only engine, so neither column chooses anything any more —
 * the dispatch uses the BUILDER_ENGINE constant. The historical record of which
 * CLI ran stays where it belongs, on `builder_build_runs.engine` and
 * `builder_attempts.engine`, which this migration does not touch.
 *
 * `down()` restores both columns with their last defaults; the per-session
 * values are gone for good, which is fine because the run rows carry them.
 */
export class DropBuilderEngineSelection1975930000000 implements MigrationInterface {
  name = 'DropBuilderEngineSelection1975930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "engine"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "defaultEngine"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "defaultEngine" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN IF NOT EXISTS "engine" character varying(40) NOT NULL DEFAULT 'opencode'`,
    );
  }
}
