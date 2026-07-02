import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time best-effort backfill of transcript-derived START latency into
 * scenario_session_start_metrics (source='transcript', startLatencyMs only).
 *
 * For each ended, non-preview session whose FIRST message (min startSeconds) is
 * an agent utterance (senderId < 0 — the opening dialogue), the start latency is
 * that message's startSeconds (seconds from session/recording start to the agent
 * speaking its opening line). This EXCLUDES the pre-join configure/initialize
 * time (recording begins after the agent joins), so it is a lower bound vs the
 * live 'pipeline' metric — dashboards separate the two by `source`.
 *
 * Optimised like BackfillTranscriptTurnMetrics: set-based INSERT..SELECT,
 * scoped to ended non-preview sessions with timed messages, processed
 * month-by-month so each statement only window-sorts one month of messages.
 * Re-runnable via down() (deletes all source='transcript').
 */
export class BackfillTranscriptStartMetrics1809000000001
  implements MigrationInterface
{
  name = 'BackfillTranscriptStartMetrics1809000000001';

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
        `INSERT INTO scenario_session_start_metrics
           ("scenarioSessionId","roomId","startLatencyMs",
            "scenarioId","tenant_id","env","occurredAt","source",
            "createdAt","updatedAt")
         SELECT
           f."scenarioSessionId",
           s."roomId",
           round(f."startSeconds" * 1000)::int,
           s."scenarioId",
           s."tenant_id",
           'PROD',
           COALESCE(s."startedAt", s."createdAt")
             + (f."startSeconds" * interval '1 second'),
           'transcript',
           now(), now()
         FROM (
           SELECT m."scenarioSessionId", m."startSeconds", m."senderId",
                  row_number() OVER (PARTITION BY m."scenarioSessionId"
                                     ORDER BY m."startSeconds", m.id) AS rn
           FROM scenario_session_messages m
           JOIN scenario_sessions ss ON ss.id = m."scenarioSessionId"
           WHERE ss."endedAt" IS NOT NULL
             AND ss."roomId" NOT LIKE 'preview-%'
             AND ss."tenant_id" IS NOT NULL
             AND COALESCE(ss."startedAt", ss."createdAt") >= $1
             AND COALESCE(ss."startedAt", ss."createdAt") <  $2
             AND m."startSeconds" IS NOT NULL
         ) f
         JOIN scenario_sessions s ON s.id = f."scenarioSessionId"
         WHERE f.rn = 1
           AND f."senderId" < 0
           AND f."startSeconds" >= 0`,
        [cursor.toISOString(), next.toISOString()],
      );

      cursor = next;
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM scenario_session_start_metrics WHERE "source" = 'transcript'`,
    );
  }
}
