import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record WHY a session that reached ENDED/COMPLETED got there, when it was
 * not the ordinary case.
 *
 * Until now, a session force-exited by ally-ai-learn's stall watchdog (most
 * often because the learner's connection dropped and never recovered before
 * the force-exit grace expired) was scored and closed out exactly like a
 * session the learner finished normally — `status`/`eventStatus` cannot tell
 * them apart, and the only trace was a super-admin-only lifecycle event. That
 * left the learner with no explanation on their summary screen, and nobody
 * later reviewing the session any way to tell a technical interruption apart
 * from a real finish.
 *
 * Same shape as `1932000000000-AddScenarioSessionAbandonedState`: a plain
 * `character varying` column, no Postgres enum, so future reason values are a
 * TypeScript-only change.
 *
 * NO BACKFILL, for the same reason as that migration: a historical ENDED row
 * cannot be classified after the fact without guessing. Only sessions ended
 * this way from here on are marked.
 *
 * ANALYTICS IMPACT: none. `endReason` is only ever written alongside a
 * status/eventStatus transition that already happens today (ACTIVE->ENDED,
 * IN_PROGRESS->COMPLETED) — no query's filter set changes, and no existing
 * row is touched.
 */
export class AddScenarioSessionEndReason1933000000000 implements MigrationInterface {
  name = 'AddScenarioSessionEndReason1933000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS: re-runnable if this was ever applied locally under a
    // different timestamp before being renumbered upstream.
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD COLUMN IF NOT EXISTS "endReason" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN IF EXISTS "endReason"`,
    );
  }
}
