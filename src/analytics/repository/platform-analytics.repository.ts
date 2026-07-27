import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';

/**
 * Bucket granularity for time-series aggregation. Controlled internally by the
 * service (never user input) so it is safe to interpolate into `date_trunc`.
 */
export type AnalyticsBucket = 'day' | 'week' | 'month';

export interface AgentJoinReliabilityBucketRow {
  bucket: string;
  totalSessions: number;
  joinFailures: number;
  midSessionDrops: number;
  joinLatencyP50Sec: number | null;
  joinLatencyP95Sec: number | null;
}

export interface SessionOutcomeMixRow {
  completed: number;
  noConversation: number;
  inProgress: number;
}

export interface SuspectedFreezeBucketRow {
  bucket: string;
  conversations: number;
  suspectedFreezes: number;
}

export interface NewUsersBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  newUsers: number;
}

export interface DailyActivityRow {
  /** Activity day as a calendar date string (yyyy-mm-dd). */
  day: string;
  counselorId: number;
}

export interface WeeklyCountRow {
  /** ISO week start (Monday) as a calendar date string (yyyy-mm-dd). */
  week: string;
  count: number;
}

export interface WeeklyActiveUserRow {
  /** ISO week start (Monday) of the activity, as yyyy-mm-dd. */
  week: string;
  counselorId: number;
  /** The user's account creation date, as yyyy-mm-dd. */
  userCreatedAt: string;
}

export interface UsersByRoleRow {
  role: string;
  count: number;
}

export interface VoiceLatencyBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** How the metrics were produced: 'pipeline' (live agent) or 'transcript'. */
  source: string;
  /** Turns aggregated into this bucket. */
  turns: number;
  /** Mean voice-to-voice latency (ms) in the bucket. */
  avgMs: number;
  /** Median (p50) voice-to-voice latency (ms) in the bucket. */
  p50Ms: number;
  /** p95 voice-to-voice latency (ms) in the bucket. */
  p95Ms: number;
}

export interface VoiceLatencyByLanguageRow {
  language: string;
  /** Live-pipeline turns aggregated for this language. */
  turns: number;
  /** Mean voice-to-voice latency (ms). */
  avgMs: number;
  /** p95 voice-to-voice latency (ms). */
  p95Ms: number;
}

export interface StartLatencyBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** How the metrics were produced: 'pipeline' (live agent) or 'transcript'. */
  source: string;
  /** Sessions aggregated into this bucket. */
  sessions: number;
  /** Mean total start latency / time-to-first-word (ms). */
  avgMs: number;
  /** Median (p50) total start latency (ms). */
  p50Ms: number;
  /** p95 total start latency (ms). */
  p95Ms: number;
  /** Mean configure() segment (ms); 0 for transcript rows (segment NULL). */
  configureMs: number;
  /** Mean initialize() segment (ms); 0 for transcript rows. */
  initializeMs: number;
  /** Mean connect (session.start + join) segment (ms); 0 for transcript rows. */
  connectMs: number;
  /** Mean prep (orchestrator + background audio) segment (ms); 0 for transcript. */
  prepMs: number;
}

/**
 * Raw cross-table aggregation for the super-admin analytics overview.
 *
 * Uses a `DataSource`-backed query builder (rather than a single-entity
 * repository) because the queries span `users`, `scenario_sessions`,
 * `user_groups` and `groups`. Column names are the default TypeORM camelCase
 * identifiers (quoted in SQL); `tenantId` maps to the `tenant_id` column.
 * These are platform-wide (super-admin) metrics, so they are deliberately
 * NOT scoped to a tenant.
 *
 * Truncated dates are returned as `yyyy-mm-dd` strings (`to_char`) rather than
 * timestamps: `date_trunc` on the tz-naive `timestamp` columns is pure
 * calendar math, so the string keys match a UTC-generated JS axis exactly,
 * regardless of the Node process timezone. Counts are cast to `::int` so the
 * pg driver returns JS numbers; the service still parses defensively. Heavier
 * shaping (cumulative sums, rolling DAU/WAU/MAU, new-vs-returning labelling) is
 * done in JS to keep the SQL simple.
 */
@Injectable()
export class PlatformAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): 'day' | 'week' | 'month' {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    return 'week';
  }

  /**
   * Agent-join reliability per time bucket, derived from the session lifecycle
   * log. Each session is bucketed by its first lifecycle event (room created).
   * `joinFailures` = sessions with lifecycle events but no AGENT_JOINED;
   * `midSessionDrops` = AGENT_JOINED followed by an AGENT_LEFT; join latency =
   * AGENT_DISPATCHED -> AGENT_JOINED gap (seconds), percentiles over the
   * sessions that did join. `trunc` is whitelisted by resolveBucket.
   */
  async getAgentJoinReliabilityByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<AgentJoinReliabilityBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource.query(
      `
      WITH per_session AS (
        SELECT
          date_trunc('${trunc}', min(l."occurredAt")) AS bucket_ts,
          bool_or(l."type" = 'AGENT_JOINED') AS agent_joined,
          bool_or(l."type" = 'AGENT_LEFT')   AS agent_left,
          min(l."occurredAt") FILTER (WHERE l."type" = 'AGENT_DISPATCHED') AS dispatched_at,
          min(l."occurredAt") FILTER (WHERE l."type" = 'AGENT_JOINED')     AS joined_at
        FROM scenario_session_lifecycle_events l
        WHERE l."occurredAt" >= $1 AND l."occurredAt" < $2
        GROUP BY l."scenarioSessionId"
      )
      SELECT
        to_char(bucket_ts, 'YYYY-MM-DD') AS bucket,
        COUNT(*)::int AS "totalSessions",
        COUNT(*) FILTER (WHERE NOT agent_joined)::int AS "joinFailures",
        COUNT(*) FILTER (WHERE agent_joined AND agent_left)::int AS "midSessionDrops",
        round(percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (joined_at - dispatched_at))
        ) FILTER (WHERE agent_joined AND dispatched_at IS NOT NULL))::int AS "joinLatencyP50Sec",
        round(percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (joined_at - dispatched_at))
        ) FILTER (WHERE agent_joined AND dispatched_at IS NOT NULL))::int AS "joinLatencyP95Sec"
      FROM per_session
      GROUP BY bucket_ts
      ORDER BY bucket_ts ASC
      `,
      [start, end],
    );
    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      totalSessions: Number(r.totalSessions) || 0,
      joinFailures: Number(r.joinFailures) || 0,
      midSessionDrops: Number(r.midSessionDrops) || 0,
      joinLatencyP50Sec:
        r.joinLatencyP50Sec === null ? null : Number(r.joinLatencyP50Sec),
      joinLatencyP95Sec:
        r.joinLatencyP95Sec === null ? null : Number(r.joinLatencyP95Sec),
    }));
  }

  /**
   * Overall session outcome mix over [start, end): COMPLETED (ended with a
   * transcript), NO_CONVERSATION (ended empty — includes agent-never-joined),
   * IN_PROGRESS (still active). Mirrors the derived `outcome` in
   * roleplay-session-logs. Excludes preview/seed rooms.
   */
  async getSessionOutcomeMix(
    start: Date,
    end: Date,
  ): Promise<SessionOutcomeMixRow> {
    const rows = await this.dataSource.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE ss."status" = 'ACTIVE')::int AS "inProgress",
        COUNT(*) FILTER (WHERE ss."status" = 'ENDED' AND EXISTS (
          SELECT 1 FROM scenario_session_messages m WHERE m."scenarioSessionId" = ss.id
        ))::int AS "completed",
        COUNT(*) FILTER (WHERE ss."status" = 'ENDED' AND NOT EXISTS (
          SELECT 1 FROM scenario_session_messages m WHERE m."scenarioSessionId" = ss.id
        ))::int AS "noConversation"
      FROM scenario_sessions ss
      WHERE ss."createdAt" >= $1 AND ss."createdAt" < $2
        AND ss."roomId" LIKE 'ss_%'
      `,
      [start, end],
    );
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      completed: Number(r.completed) || 0,
      noConversation: Number(r.noConversation) || 0,
      inProgress: Number(r.inProgress) || 0,
    };
  }

  /**
   * Suspected mid-session "freeze" rate per time bucket. Among sessions that
   * actually had a conversation (>=1 agent turn), a freeze is either (a) the
   * conversation ended on a HUMAN turn the agent never answered — the last
   * transcript message is the learner's — or (b) any turn's LLM call timed out.
   * Bucketed by session createdAt. All join columns are uuid/int (no casts).
   * `trunc` is whitelisted by resolveBucket.
   */
  async getSuspectedFreezeByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<SuspectedFreezeBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource.query(
      `
      WITH sess AS (
        SELECT
          ss."createdAt" AS created_at,
          EXISTS (
            SELECT 1 FROM scenario_session_messages m
            WHERE m."scenarioSessionId" = ss.id AND m."senderId" <> ss."counselorId"
          ) AS has_agent,
          (
            SELECT m."senderId" = ss."counselorId"
            FROM scenario_session_messages m
            WHERE m."scenarioSessionId" = ss.id
            ORDER BY m."startSeconds" DESC NULLS LAST, m."createdAt" DESC
            LIMIT 1
          ) AS last_is_human,
          EXISTS (
            SELECT 1 FROM scenario_session_turn_metrics t
            WHERE t."scenarioSessionId" = ss.id AND t."llmTimedOut" = true
          ) AS llm_timeout
        FROM scenario_sessions ss
        WHERE ss."createdAt" >= $1 AND ss."createdAt" < $2
          AND ss."roomId" LIKE 'ss_%'
      )
      SELECT
        to_char(date_trunc('${trunc}', created_at), 'YYYY-MM-DD') AS bucket,
        COUNT(*) FILTER (WHERE has_agent)::int AS "conversations",
        COUNT(*) FILTER (
          WHERE has_agent AND (COALESCE(last_is_human, false) OR llm_timeout)
        )::int AS "suspectedFreezes"
      FROM sess
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      [start, end],
    );
    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      conversations: Number(r.conversations) || 0,
      suspectedFreezes: Number(r.suspectedFreezes) || 0,
    }));
  }

  /**
   * New users per time bucket within [start, end). Cumulative totals are
   * computed in the service from these counts plus {@link getUserCountBefore}.
   */
  async getNewUsersByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<NewUsersBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', u."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'newUsers')
      .from('users', 'u')
      .where('u."createdAt" >= :start', { start })
      .andWhere('u."createdAt" < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; newUsers: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      newUsers: Number(r.newUsers) || 0,
    }));
  }

  /** Total number of users created strictly before `date` (cumulative baseline). */
  async getUserCountBefore(date: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .where('u."createdAt" < :date', { date })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Total number of users on the platform. */
  async getTotalUsers(): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct (day, counselorId) activity pairs from scenario sessions within
   * [start, end). Pass a start that is 29 days before the visible window so the
   * service can compute correct trailing 7-/30-day rolls at the left edge.
   * Activity timestamp is `COALESCE(startedAt, createdAt)`.
   */
  async getDailyActivityPairs(
    start: Date,
    end: Date,
  ): Promise<DailyActivityRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(COALESCE(s."startedAt", s."createdAt"), 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect('s."counselorId"', 'counselorId')
      .distinct(true)
      .from('scenario_sessions', 's')
      .where('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .getRawMany<{ day: string; counselorId: number }>();

    return rows.map((r) => ({
      day: r.day,
      counselorId: Number(r.counselorId),
    }));
  }

  /**
   * Completed simulations grouped by ISO week within [start, end).
   * Completion timestamp is `COALESCE(endedAt, createdAt)`.
   */
  async getSimulationsCompletedByWeek(
    start: Date,
    end: Date,
  ): Promise<WeeklyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('week', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'week',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('week')
      .orderBy('week', 'ASC')
      .getRawMany<{ week: string; count: number }>();

    return rows.map((r) => ({
      week: r.week,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct weekly-active (week, counselorId) pairs within [start, end),
   * joined to the user's account creation date so the service can label each
   * weekly-active user as "new" (account created that week) or "returning".
   * Activity timestamp is `COALESCE(startedAt, createdAt)`.
   */
  async getWeeklyActivePairsWithCreatedAt(
    start: Date,
    end: Date,
  ): Promise<WeeklyActiveUserRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('week', COALESCE(s."startedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'week',
      )
      .addSelect('s."counselorId"', 'counselorId')
      .addSelect(`to_char(u."createdAt", 'YYYY-MM-DD')`, 'userCreatedAt')
      .distinct(true)
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .getRawMany<{
        week: string;
        counselorId: number;
        userCreatedAt: string;
      }>();

    return rows.map((r) => ({
      week: r.week,
      counselorId: Number(r.counselorId),
      userCreatedAt: r.userCreatedAt,
    }));
  }

  /** Distinct user counts grouped by role/group name. */
  async getUsersByRole(): Promise<UsersByRoleRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('g.name', 'role')
      .addSelect('COUNT(DISTINCT ug."userId")::int', 'count')
      .from('user_groups', 'ug')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .groupBy('g.name')
      .orderBy('count', 'DESC')
      .getRawMany<{ role: string; count: number }>();

    return rows.map((r) => ({
      role: r.role,
      count: Number(r.count) || 0,
    }));
  }

  /** Distinct users with any session activity since `since`. */
  async getActiveUserCountSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct active users since `since` whose account predates `since`
   * (i.e. returning users, used for the retention rate).
   */
  async getReturningActiveUserCountSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .andWhere('u."createdAt" < :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Voice-to-voice latency aggregated per time bucket AND per `source`
   * (pipeline vs transcript) within [start, end), over
   * `scenario_session_turn_metrics`. Returns avg / p50 / p95 of
   * `responseLatencyMs` plus the turn count for each (bucket, source) pair.
   *
   * Split by `source` so the live-pipeline trend and the historical
   * transcript-derived trend are never silently mixed (they measure latency
   * differently). The table is not registered as a TypeORM entity here, so it
   * is queried by name via the DataSource query builder; `occurredAt` is the
   * tz-naive turn timestamp, so `date_trunc` is pure calendar math (matches the
   * service's UTC axis). Buckets with no turns are simply absent — latency has
   * no meaningful zero, so the service does NOT gap-fill these.
   */
  async getVoiceLatencyByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    language?: string,
  ): Promise<VoiceLatencyBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', m."occurredAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('m."source"', 'source')
      .addSelect('COUNT(*)::int', 'turns')
      .addSelect('round(avg(m."responseLatencyMs"))::int', 'avgMs')
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p50Ms',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95Ms',
      )
      .from('scenario_session_turn_metrics', 'm');
    if (language) {
      // turn_metrics.language is largely unpopulated, so filter by the SESSION's
      // configured language (join to scenario_sessions -> languages), matching
      // how drift derives language.
      qb.innerJoin(
        'scenario_sessions',
        's',
        's.id = m."scenarioSessionId"',
      ).leftJoin(
        'languages',
        'l',
        `l.id = NULLIF(s.metadata->>'languageId', '')::int`,
      );
    }
    qb.where('m."occurredAt" >= :start', { start })
      .andWhere('m."occurredAt" < :end', { end })
      .andWhere('m."responseLatencyMs" IS NOT NULL');
    if (language) {
      qb.andWhere(`COALESCE(l.value, 'en') = :language`, { language });
    }
    const rows = await qb
      .groupBy('bucket')
      .addGroupBy('m."source"')
      .orderBy('bucket', 'ASC')
      .addOrderBy('m."source"', 'ASC')
      .getRawMany<{
        bucket: string;
        source: string;
        turns: number;
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      source: r.source,
      turns: Number(r.turns) || 0,
      avgMs: Number(r.avgMs) || 0,
      p50Ms: Number(r.p50Ms) || 0,
      p95Ms: Number(r.p95Ms) || 0,
    }));
  }

  /**
   * Live-pipeline voice-to-voice latency (avg/p95), one row per language, over
   * the whole window (no time bucketing) — the "which language is slow" view
   * that sits alongside the time-series trend from
   * {@link getVoiceLatencyByBucket}. Scoped to source='pipeline' only (the
   * live-agent numbers; 'transcript' rows are historical/derived and would
   * muddy a cross-language comparison). Joins back to the owning session's
   * configured language the same way the `language` filter branch of
   * {@link getVoiceLatencyByBucket} does — `m."language"` itself is largely
   * unpopulated, so it's not used for grouping. Unresolved languages
   * (deleted/misconfigured languages row) fall back to 'en', matching that
   * same filter branch. Grouped/ordered by the raw expression rather than the
   * `language` output alias: `scenario_session_turn_metrics` has its own (real,
   * if sparse) `language` column, and Postgres resolves a GROUP BY/ORDER BY
   * name against an input column of that name in preference to an output
   * alias — grouping by the alias would silently group by the wrong column.
   */
  async getVoiceLatencyByLanguage(
    start: Date,
    end: Date,
  ): Promise<VoiceLatencyByLanguageRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(`COALESCE(l."value", 'en')`, 'language')
      .addSelect('COUNT(*)::int', 'turns')
      .addSelect('round(avg(m."responseLatencyMs"))::int', 'avgMs')
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95Ms',
      )
      .from('scenario_session_turn_metrics', 'm')
      .innerJoin('scenario_sessions', 's', 's.id = m."scenarioSessionId"')
      .leftJoin(
        'languages',
        'l',
        `l.id = NULLIF(s.metadata->>'languageId', '')::int`,
      )
      .where('m."occurredAt" >= :start', { start })
      .andWhere('m."occurredAt" < :end', { end })
      .andWhere(`m."source" = 'pipeline'`)
      .andWhere('m."responseLatencyMs" IS NOT NULL')
      .groupBy(`COALESCE(l."value", 'en')`)
      .orderBy(`COALESCE(l."value", 'en')`, 'ASC')
      .getRawMany<{
        language: string;
        turns: number;
        avgMs: number;
        p95Ms: number;
      }>();

    return rows.map((r) => ({
      language: r.language,
      turns: Number(r.turns) || 0,
      avgMs: Number(r.avgMs) || 0,
      p95Ms: Number(r.p95Ms) || 0,
    }));
  }

  /**
   * Per-bucket, per-source simulation START latency ("time to first word") from
   * scenario_session_start_metrics. Returns the total (avg / p50 / p95) plus the
   * mean of each segment (configure / initialize / connect / prep) so the chart
   * can stack the breakdown; for 'transcript' rows the segments are NULL and
   * coalesce to 0 (total only). Split by `source` so live-pipeline and
   * transcript-derived rows are never mixed. `occurredAt` is tz-naive, so
   * `date_trunc` is pure calendar math (matches the service's UTC axis). Buckets
   * with no sessions are absent (latency has no meaningful zero).
   */
  async getStartLatencyByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    language?: string,
  ): Promise<StartLatencyBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', m."occurredAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('m."source"', 'source')
      .addSelect('COUNT(*)::int', 'sessions')
      .addSelect('round(avg(m."startLatencyMs"))::int', 'avgMs')
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."startLatencyMs"))::int`,
        'p50Ms',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."startLatencyMs"))::int`,
        'p95Ms',
      )
      .addSelect('round(avg(m."configureMs"))::int', 'configureMs')
      .addSelect('round(avg(m."initializeMs"))::int', 'initializeMs')
      .addSelect('round(avg(m."connectMs"))::int', 'connectMs')
      .addSelect('round(avg(m."prepMs"))::int', 'prepMs')
      .from('scenario_session_start_metrics', 'm');
    if (language) {
      // start_metrics.language is largely unpopulated, so filter by the
      // SESSION's configured language (join to scenario_sessions -> languages),
      // matching how voice-latency / drift derive language.
      qb.innerJoin(
        'scenario_sessions',
        's',
        's.id = m."scenarioSessionId"',
      ).leftJoin(
        'languages',
        'l',
        `l.id = NULLIF(s.metadata->>'languageId', '')::int`,
      );
    }
    qb.where('m."occurredAt" >= :start', { start })
      .andWhere('m."occurredAt" < :end', { end })
      .andWhere('m."startLatencyMs" IS NOT NULL');
    if (language) {
      qb.andWhere(`COALESCE(l.value, 'en') = :language`, { language });
    }
    const rows = await qb
      .groupBy('bucket')
      .addGroupBy('m."source"')
      .orderBy('bucket', 'ASC')
      .addOrderBy('m."source"', 'ASC')
      .getRawMany<{
        bucket: string;
        source: string;
        sessions: number;
        avgMs: number;
        p50Ms: number;
        p95Ms: number;
        configureMs: number;
        initializeMs: number;
        connectMs: number;
        prepMs: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      source: r.source,
      sessions: Number(r.sessions) || 0,
      avgMs: Number(r.avgMs) || 0,
      p50Ms: Number(r.p50Ms) || 0,
      p95Ms: Number(r.p95Ms) || 0,
      configureMs: Number(r.configureMs) || 0,
      initializeMs: Number(r.initializeMs) || 0,
      connectMs: Number(r.connectMs) || 0,
      prepMs: Number(r.prepMs) || 0,
    }));
  }

  /** Completed simulations whose completion timestamp is on/after `since`. */
  async getCompletedSimsSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }
}
