import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time backfill of transcript-derived voice-to-voice latency into
 * scenario_session_turn_metrics (source='transcript', responseLatencyMs only).
 *
 * For each AI reply (senderId < 0) immediately preceded by a human turn
 * (senderId > 0), v2v = agent.startSeconds - prevHuman.endSeconds, taken from
 * scenario_session_messages timings.
 *
 * Optimised for large prod data:
 *  - set-based INSERT..SELECT, no per-row correlated subqueries;
 *  - scoped to ended, non-preview sessions with timed messages;
 *  - processed month-by-month so each statement only window-sorts one month's
 *    messages instead of the whole table (bounded memory / no giant spill);
 *  - message lookups ride the existing scenario_session_messages session-id
 *    index.
 *
 * Covers history up to deploy time; ongoing new sessions are handled separately
 * (scheduled job). Re-runnable via down() (deletes all source='transcript').
 */
export class BackfillTranscriptTurnMetrics1781400000000 implements MigrationInterface {
  name = 'BackfillTranscriptTurnMetrics1781400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const bounds: Array<{ lo: Date | null; hi: Date | null }> =
      await queryRunner.query(
        `SELECT date_trunc('month', min(COALESCE("startedAt","createdAt"))) AS lo,
                date_trunc('month', max(COALESCE("startedAt","createdAt"))) AS hi
         FROM scenario_sessions
         WHERE "endedAt" IS NOT NULL AND "roomId" NOT LIKE 'preview-%'`,
      );
    const lo = bounds[0]?.lo;
    const hi = bounds[0]?.hi;
    if (!lo || !hi) return;

    let cursor = new Date(lo);
    const end = new Date(hi);
    while (cursor <= end) {
      const next = new Date(cursor);
      next.setUTCMonth(next.getUTCMonth() + 1);

      await queryRunner.query(
        `INSERT INTO scenario_session_turn_metrics
           ("scenarioSessionId","roomId","turnIndex","responseLatencyMs",
            "scenarioId","tenant_id","env","occurredAt","source",
            "createdAt","updatedAt")
         SELECT
           t."scenarioSessionId",
           s."roomId",
           (row_number() OVER (PARTITION BY t."scenarioSessionId"
                               ORDER BY t."startSeconds", t.id) - 1),
           round((t."startSeconds" - t.prev_end) * 1000)::int,
           s."scenarioId",
           s."tenant_id",
           'PROD',
           COALESCE(s."startedAt", s."createdAt")
             + (t."startSeconds" * interval '1 second'),
           'transcript',
           now(), now()
         FROM (
           SELECT m."scenarioSessionId", m.id, m."startSeconds", m."senderId",
                  LAG(m."endSeconds") OVER w AS prev_end,
                  LAG(m."senderId")   OVER w AS prev_sender
           FROM scenario_session_messages m
           JOIN scenario_sessions ss ON ss.id = m."scenarioSessionId"
           WHERE ss."endedAt" IS NOT NULL
             AND ss."roomId" NOT LIKE 'preview-%'
             AND COALESCE(ss."startedAt", ss."createdAt") >= $1
             AND COALESCE(ss."startedAt", ss."createdAt") <  $2
           WINDOW w AS (PARTITION BY m."scenarioSessionId"
                        ORDER BY m."startSeconds", m.id)
         ) t
         JOIN scenario_sessions s ON s.id = t."scenarioSessionId"
         WHERE t."senderId" < 0
           AND t.prev_sender > 0
           AND t."startSeconds" IS NOT NULL
           AND t.prev_end IS NOT NULL
           AND t."startSeconds" >= t.prev_end`,
        [cursor.toISOString(), next.toISOString()],
      );

      cursor = next;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM scenario_session_turn_metrics WHERE "source" = 'transcript'`,
    );
  }
}
