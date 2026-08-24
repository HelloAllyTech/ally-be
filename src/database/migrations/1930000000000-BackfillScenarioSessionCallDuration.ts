import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `scenario_session_details."callDuration"` for ended sessions that
 * never got one.
 *
 * Until this release the column was written in exactly one place — the summary
 * writer reached from `endScenarioSession`. A session that reached its natural
 * end via the agent's `end-of-session` event had `status` set to ENDED by
 * `handleEndScenarioSessionEvent`, which made the subsequent `room_finished`
 * webhook skip `endScenarioSession` entirely (RoomFinishedHandler only ends
 * sessions not already ENDED). So whenever the learner never clicked "End"
 * themselves, the duration was computed, used for path/case/track progress and
 * the leaderboard, and then thrown away.
 *
 * Every analytics surface that sums the column read those sessions as zero
 * practice minutes — the per-learner "Total practice minutes" table and the
 * "avg practice minutes per learner" KPI understated, and the Highlights
 * play-time charts (which filter `callDuration > 0`) dropped them — while
 * Roleplay Logs showed the real duration, because it derives wall clock from
 * `startedAt`/`endedAt` instead.
 *
 * The value written here is the same one every writer persists:
 * `endedAt - startedAt - totalPausedMs`, in MILLISECONDS. Preview and seeded
 * rooms are excluded, matching `countableSessionPredicate`. Rows whose
 * computed duration overflows the `int` column (~24.8 days, only reachable
 * from a broken `endedAt`) are left alone rather than truncated.
 */
export class BackfillScenarioSessionCallDuration1930000000000 implements MigrationInterface {
  name = 'BackfillScenarioSessionCallDuration1930000000000';

  /** Shared source of truth for both statements below. */
  private static readonly ENDED_SESSIONS_WITH_DURATION = `
    SELECT s.id,
           s.tenant_id,
           (EXTRACT(EPOCH FROM (s."endedAt" - s."startedAt")) * 1000
              - COALESCE(s."totalPausedMs", 0))::bigint AS ms
    FROM scenario_sessions s
    WHERE s.status = 'ENDED'
      AND s."startedAt" IS NOT NULL
      AND s."endedAt" IS NOT NULL
      AND s."roomId" NOT LIKE 'preview-%'
      AND s."roomId" NOT LIKE 'seed-room-%'
  `;

  public async up(queryRunner: QueryRunner): Promise<void> {
    const source =
      BackfillScenarioSessionCallDuration1930000000000.ENDED_SESSIONS_WITH_DURATION;

    // 1) Sessions that already have a details row (written by the evaluation
    //    upsert, or by a summary writer that returned before persisting) but
    //    no duration on it. Only NULL/0 is touched, so a genuinely recorded
    //    duration is never overwritten.
    const filled = await queryRunner.query(`
      UPDATE scenario_session_details d
      SET "callDuration" = c.ms::int,
          "updatedAt"    = now()
      FROM (${source}) c
      WHERE d."scenarioSessionId" = c.id
        AND (d."callDuration" IS NULL OR d."callDuration" = 0)
        AND c.ms BETWEEN 1 AND 2147483647
    `);

    // 2) Sessions with no details row at all — nothing ever wrote one because
    //    neither the summary nor the evaluation path ran.
    const created = await queryRunner.query(`
      INSERT INTO scenario_session_details ("scenarioSessionId", tenant_id, "callDuration")
      SELECT c.id, c.tenant_id, c.ms::int
      FROM (${source}) c
      WHERE c.ms BETWEEN 1 AND 2147483647
        AND NOT EXISTS (
          SELECT 1 FROM scenario_session_details d
          WHERE d."scenarioSessionId" = c.id
        )
      ON CONFLICT ("scenarioSessionId") DO NOTHING
    `);

    // Row counts land in the deploy log so the backfill's reach is auditable
    // against the dashboards it is meant to correct.
    console.log(
      `[1930] callDuration backfill: filled ${filled?.[1] ?? 0} existing ` +
        `row(s), created ${created?.[1] ?? 0} new row(s).`,
    );
  }

  public async down(): Promise<void> {
    // Deliberately a no-op: a backfilled duration is indistinguishable from
    // one the application wrote, so there is nothing safe to revert. Reverting
    // the code change is enough to stop new rows being written this way.
  }
}
