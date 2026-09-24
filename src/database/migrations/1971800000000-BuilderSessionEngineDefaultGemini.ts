import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_sessions.engine` defaults to 'gemini' rather than 'claude-code'.
 *
 * Only the DEFAULT moves. Existing rows keep whatever engine they actually ran
 * on: a session's engine is the record of which CLI produced its branches and
 * its cost figures, and rewriting that would make every past run's reporting
 * lie about itself.
 *
 * The default is a backstop in any case — BuilderSessionService stamps
 * `settings.defaultEngine` at creation precisely because a non-null column
 * default makes the dispatch's `?? settings.defaultEngine` rung unreachable.
 * It matters for a row written by anything that bypasses that service (a seed,
 * a fixture, a manual insert), which should no longer land on Claude Code.
 */
export class BuilderSessionEngineDefaultGemini1971800000000 implements MigrationInterface {
  name = 'BuilderSessionEngineDefaultGemini1971800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ALTER COLUMN "engine" SET DEFAULT 'gemini'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ALTER COLUMN "engine" SET DEFAULT 'claude-code'`,
    );
  }
}
