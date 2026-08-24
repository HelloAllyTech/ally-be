import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support an explicit ABANDONED state for roleplay sessions.
 *
 * A crashed roleplay used to be indistinguishable from a finished one.
 * `scenario_sessions.status` held only ACTIVE|ENDED and `"eventStatus"` only
 * IN_PROGRESS|COMPLETED, so a session whose agent died mid-conversation, or
 * whose learner's connection dropped, or which sat ACTIVE forever because no
 * `end-of-session` message ever arrived, all read exactly like a learner who
 * worked through a scenario and clicked End.
 *
 * WHAT THIS DOES *NOT* NEED TO DO, and why there is so little DDL here: both
 * columns are `character varying`, not Postgres enums (see
 * `1764309737921-addScenarioSessionEventStatusColumn`, which added `"eventStatus"`
 * as `character varying NOT NULL DEFAULT 'IN_PROGRESS'`). New values are a
 * TypeScript-side change and require no `ALTER TYPE`. So this migration adds only
 * the two things that genuinely need schema support: somewhere to record WHY a
 * session was abandoned, and an index the sweeper can use.
 *
 * NO BACKFILL, deliberately. Historical rows sitting at ENDED/IN_PROGRESS cannot
 * be classified after the fact — that combination is also what a perfectly normal
 * session looks like when it ended via the client's End button rather than the
 * agent's SQS event, because COMPLETED is written from exactly one code path.
 * Guessing would manufacture crashes that never happened, in a table every
 * analytics surface reads. Only sessions observed abandoned from here on are
 * marked.
 *
 * ANALYTICS IMPACT: none, by construction. `status = 'ABANDONED'` is only ever
 * written over `ACTIVE`, and every analytics query filters `status = 'ENDED'`;
 * `"eventStatus" = 'ABANDONED'` is only ever written over `IN_PROGRESS`, and
 * those queries filter `= 'COMPLETED'`. Every write moves a row from a value
 * already excluded to another already excluded.
 */
export class AddScenarioSessionAbandonedState1932000000000
  implements MigrationInterface
{
  name = 'AddScenarioSessionAbandonedState1932000000000';

  /**
   * Partial index backing the stuck-session sweeper, whose query is
   * `status = 'ACTIVE' AND "startedAt" < cutoff`.
   *
   * PARTIAL on `status = 'ACTIVE'` for two reasons: the live set is a tiny
   * fraction of the table (nearly every row is terminal), so the index stays
   * small and cheap to maintain; and each session's row leaves the index as soon
   * as it ends, which is exactly the churn pattern a partial index handles best.
   */
  private static readonly SWEEP_INDEX = 'scenario_sessions_active_started_idx';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS on both statements: this migration is re-runnable, which
    // matters on a developer machine where it may have been applied under a
    // different timestamp before being renumbered upstream (the 42P07 trap).
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD COLUMN IF NOT EXISTS "abandonedReason" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "${AddScenarioSessionAbandonedState1932000000000.SWEEP_INDEX}" ` +
        `ON "scenario_sessions" ("startedAt") WHERE status = 'ACTIVE'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible in full: the index is derived, and the column only ever holds
    // values written by code this migration ships alongside. Dropped in the
    // reverse order of creation.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "${AddScenarioSessionAbandonedState1932000000000.SWEEP_INDEX}"`,
    );
    // Any row this release marked ABANDONED is returned to the state the old
    // two-value enums could represent, so a rolled-back deployment does not read
    // a value its code has never heard of. ACTIVE rather than ENDED for the
    // status: a swept session never legitimately ended, and resurrecting it as
    // ENDED would feed a fabricated completion to analytics.
    await queryRunner.query(
      `UPDATE "scenario_sessions" SET status = 'ACTIVE' WHERE status = 'ABANDONED'`,
    );
    await queryRunner.query(
      `UPDATE "scenario_sessions" SET "eventStatus" = 'IN_PROGRESS' WHERE "eventStatus" = 'ABANDONED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN IF EXISTS "abandonedReason"`,
    );
  }
}
