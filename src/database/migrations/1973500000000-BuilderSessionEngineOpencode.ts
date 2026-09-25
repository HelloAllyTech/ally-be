import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Point `builder_sessions.engine`'s column default at the only engine there is.
 *
 * The default has followed the engine each time it moved — 'claude-code', then
 * 'gemini', now 'opencode' — and it matters less than it looks, because
 * `BuilderSessionService` stamps the resolved engine explicitly at creation.
 * That is deliberate: a non-null column default makes the
 * `?? settings.defaultEngine` rung unreachable, which is how the admin's
 * "default engine" picker once applied to no new session ever.
 *
 * So this is the backstop, not the mechanism. It is updated anyway because a
 * backstop naming an engine whose invocation case, install step and event
 * normaliser have all been deleted is a trap for whoever reads the schema next.
 *
 * Existing rows keep the engine they actually ran on. They are the record of
 * which CLI produced those branches and cost figures, and rewriting history to
 * match today's topology would make every past run unauditable. A stale value
 * costs nothing now: `builderAllowedEngines()` overrules anything off the list
 * wherever it came from, and says so in the log.
 */
export class BuilderSessionEngineOpencode1973500000000 implements MigrationInterface {
  name = 'BuilderSessionEngineOpencode1973500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ALTER COLUMN "engine" SET DEFAULT 'opencode'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ALTER COLUMN "engine" SET DEFAULT 'gemini'`,
    );
  }
}
