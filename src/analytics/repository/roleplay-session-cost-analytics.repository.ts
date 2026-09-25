import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AnalyticsBucket } from './platform-analytics.repository';
import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/** Roleplay sessions STARTED in one bucket, and the minutes they ran. */
export interface SessionBucketRow {
  /** Bucket start, `yyyy-mm-dd`. */
  bucket: string;
  sessions: number;
  /** Net of paused time; a session with no recorded duration adds 0. */
  minutes: number;
}

/**
 * One (bucket, task, service, provider, model) group of AI usage belonging to
 * the sessions started in that bucket. Priced and classified in TypeScript.
 */
export interface SessionUsageRow {
  bucket: string;
  task: string;
  service: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  audioMs: number;
  characters: number;
  calls: number;
}

/** One session's usage, grouped just finely enough to price. */
export type SingleSessionUsageRow = Omit<SessionUsageRow, 'bucket'>;

export interface SessionHeaderRow {
  id: string;
  createdAt: Date;
  minutes: number;
  status: string;
  eventStatus: string;
}

/** First session-tagged row of each marker family, or null if none yet. */
export interface CoverageRow {
  liveFrom: Date | null;
  debriefFrom: Date | null;
}

/**
 * The roleplay session as the unit of AI cost.
 *
 * ## Bucketed by when the SESSION started, not when each call ran
 *
 * A session's debrief evaluation, its debrief chat and its memory fold can land
 * minutes or days after the conversation. Bucketing each call by its own
 * `occurredAt` (as the Unit economics chart does) would split one session's
 * cost across two periods while its minutes sit in one, so the ratio would
 * move for no reason at a period boundary. Here the session is the join key:
 * every call tagged to it lands in the bucket its `createdAt` falls in, and so
 * do its minutes. A later debrief chat therefore restates the period the
 * session started in — the right behaviour for a per-session cost.
 *
 * ## Every session that was ever started
 *
 * No status filter. A session abandoned after twenty seconds still ran an
 * opener, STT and probably a filler, and that spend is part of what practice
 * costs; dropping it would flatter the unit cost exactly when failures rise. It
 * contributes its cost and whatever minutes it recorded (usually 0).
 *
 * Minutes are `scenario_session_details."callDuration"` — milliseconds, net of
 * paused time — the same figure that feeds practice minutes elsewhere.
 *
 * ## Conventions
 *
 * Platform-wide: the session's tenant decides test-org exclusion, so tenantless
 * usage rows on a real session are kept. Raw SQL by table name; the bucket is a
 * bound `date_trunc` parameter; quantities out as `::bigint` and re-parsed.
 */
@Injectable()
export class RoleplaySessionCostAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Left edge of an all-time window — the same floor every sibling uses. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getSessionsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<SessionBucketRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(date_trunc($1, s."createdAt"), 'YYYY-MM-DD')          AS "bucket",
        COUNT(*)::int                                                AS "sessions",
        COALESCE(SUM(GREATEST(d."callDuration", 0)), 0)::float / 60000.0
                                                                     AS "minutes"
      FROM scenario_sessions s
      LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
      WHERE s."createdAt" >= $2
        AND s."createdAt" < $3
        AND ${excludeTestTenants('s."tenant_id"')}
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [bucket, start, end],
    );
    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      sessions: Number(r.sessions) || 0,
      minutes: Number(r.minutes) || 0,
    }));
  }

  async getUsageByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<SessionUsageRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(date_trunc($1, s."createdAt"), 'YYYY-MM-DD')  AS "bucket",
        ${USAGE_COLUMNS}
      FROM scenario_sessions s
      JOIN llm_usage lu ON lu."scenarioSessionId" = s.id
      WHERE s."createdAt" >= $2
        AND s."createdAt" < $3
        AND ${excludeTestTenants('s."tenant_id"')}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1 ASC
      `,
      [bucket, start, end],
    );
    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      ...parseUsage(r),
    }));
  }

  async getSession(sessionId: string): Promise<SessionHeaderRow | null> {
    const rows = await this.dataSource.query(
      `
      SELECT
        s.id                                                         AS "id",
        s."createdAt"                                                AS "createdAt",
        s.status                                                     AS "status",
        s."eventStatus"                                              AS "eventStatus",
        COALESCE(SUM(GREATEST(d."callDuration", 0)), 0)::float / 60000.0
                                                                     AS "minutes"
      FROM scenario_sessions s
      LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
      WHERE s.id = $1
      GROUP BY s.id
      `,
      [sessionId],
    );
    const r = rows[0] as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      createdAt: new Date(r.createdAt as string),
      status: r.status as string,
      eventStatus: r.eventStatus as string,
      minutes: Number(r.minutes) || 0,
    };
  }

  async getSessionUsage(sessionId: string): Promise<SingleSessionUsageRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT ${USAGE_COLUMNS}
      FROM llm_usage lu
      WHERE lu."scenarioSessionId" = $1
      GROUP BY 1, 2, 3, 4
      ORDER BY 1 ASC
      `,
      [sessionId],
    );
    return rows.map(parseUsage);
  }

  /**
   * When each half of full logging first appeared — see
   * `LIVE_SESSION_COVERAGE_TASKS` for why the cutover is measured, not set.
   */
  async getCoverage(
    liveTasks: readonly string[],
    debriefTask: string,
  ): Promise<CoverageRow> {
    const rows = await this.dataSource.query(
      `
      SELECT
        MIN(lu."occurredAt") FILTER (WHERE lu.task = ANY($1))  AS "liveFrom",
        MIN(lu."occurredAt") FILTER (WHERE lu.task = $2)       AS "debriefFrom"
      FROM llm_usage lu
      WHERE lu."scenarioSessionId" IS NOT NULL
        AND (lu.task = ANY($1) OR lu.task = $2)
      `,
      [liveTasks, debriefTask],
    );
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    const asDate = (v: unknown) => (v ? new Date(v as string) : null);
    return { liveFrom: asDate(r.liveFrom), debriefFrom: asDate(r.debriefFrom) };
  }
}

/** The priceable grouping; `lu` must be the llm_usage alias. Columns 1-4 group. */
const USAGE_COLUMNS = `
        lu.task                                          AS "task",
        lu.service                                       AS "service",
        lu.provider                                      AS "provider",
        lu.model                                         AS "model",
        COALESCE(SUM(lu."promptTokens"), 0)::bigint      AS "promptTokens",
        COALESCE(SUM(lu."completionTokens"), 0)::bigint  AS "completionTokens",
        COALESCE(SUM(lu."audioMs"), 0)::bigint           AS "audioMs",
        COALESCE(SUM(lu."characters"), 0)::bigint        AS "characters",
        COUNT(*)::int                                    AS "calls"`;

const parseUsage = (r: Record<string, unknown>): SingleSessionUsageRow => ({
  task: (r.task as string) ?? 'unknown',
  service: (r.service as string) ?? 'llm',
  provider: (r.provider as string) ?? 'unknown',
  model: (r.model as string) ?? 'unknown',
  promptTokens: Number(r.promptTokens) || 0,
  completionTokens: Number(r.completionTokens) || 0,
  audioMs: Number(r.audioMs) || 0,
  characters: Number(r.characters) || 0,
  calls: Number(r.calls) || 0,
});
