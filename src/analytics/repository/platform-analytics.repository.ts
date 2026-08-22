import { Injectable } from '@nestjs/common';
import { DataSource, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import {
  excludeTestTenants,
  excludeTestTenantsBySession,
  excludeTestTenantsByUser,
} from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/**
 * Bucket granularity for time-series aggregation. Controlled internally by the
 * service (never user input) so it is safe to interpolate into `date_trunc`.
 */
export type AnalyticsBucket = 'day' | 'week' | 'month' | 'year';

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

export interface BucketCountRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  count: number;
}

export interface BucketActiveUserRow {
  /** Bucket start of the activity, as yyyy-mm-dd. */
  bucket: string;
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
  /**
   * Mean LLM time-to-first-token (ms) in the bucket. Live-instrumentation
   * only — null for 'transcript' (backfilled) buckets, which have no way to
   * derive it from message timings alone.
   */
  avgLlmTtftMs: number | null;
  /** Median (p50) LLM time-to-first-token (ms) in the bucket. Null as above. */
  p50LlmTtftMs: number | null;
  /** p95 LLM time-to-first-token (ms) in the bucket. Null as above. */
  p95LlmTtftMs: number | null;
  /**
   * Prompt-cache hit rate (%) in the bucket, ratio-of-sums
   * (sum(cachedTokens) / sum(promptTokens)). Live-instrumentation only —
   * null for 'transcript' buckets and for turns predating this being
   * instrumented.
   */
  avgCacheHitRatePct: number | null;

  // ---- What the learner heard first (metadata.firstAudioSource) ----
  // `responseLatencyMs` measures time to the agent's FIRST audio, which is a
  // thinking-filler or predictive interim reply when one played. These counts
  // say which it was, so a bucket's headline latency can be read against how
  // many of its turns were masked — otherwise a rise in filler coverage looks
  // like a latency improvement.
  /** Turns whose first audio was a thinking-filler. */
  firstAudioFillerTurns: number;
  /** Turns whose first audio was a predictive interim reply. */
  firstAudioInterimTurns: number;
  /** Turns whose first audio was the real reply (nothing masked it). */
  firstAudioReplyTurns: number;
  /**
   * Turns with no `firstAudioSource` recorded: every 'transcript' row, and
   * live rows predating the provenance instrumentation. Kept as its own
   * count rather than folded into 'reply' — those turns MAY have been masked,
   * and silently calling them unmasked would invent the very fact this split
   * exists to establish.
   */
  firstAudioUnknownTurns: number;

  /** Mean time-to-first-voice (ms) for filler-first turns. Null if none. */
  avgFirstAudioFillerMs: number | null;
  /** Mean time-to-first-voice (ms) for interim-first turns. Null if none. */
  avgFirstAudioInterimMs: number | null;
  /** Mean time-to-first-voice (ms) for reply-first turns. Null if none. */
  avgFirstAudioReplyMs: number | null;

  /**
   * Mean time to the REAL reply (ms) — `metadata.replyLatencyMs` on masked
   * turns, `responseLatencyMs` on unmasked ones. This is the unmasked
   * pipeline number: it does not move when filler coverage changes.
   *
   * Computed over instrumented turns only (those carrying a
   * `firstAudioSource`), so it is null for 'transcript' buckets and for
   * windows predating the instrumentation. Turns without provenance are
   * EXCLUDED rather than assumed unmasked, which would drag this toward the
   * masked number and hide exactly the regression it exists to show.
   */
  avgReplyLatencyMs: number | null;
  /** Median (p50) time to the real reply (ms). Null as above. */
  p50ReplyLatencyMs: number | null;
  /** p95 time to the real reply (ms). Null as above. */
  p95ReplyLatencyMs: number | null;
}

export interface VoiceLatencyByLanguageRow {
  language: string;
  /** Live-pipeline turns aggregated for this language. */
  turns: number;
  /** Mean voice-to-voice latency (ms). */
  avgMs: number;
  /** p95 voice-to-voice latency (ms). */
  p95Ms: number;
  /**
   * Mean pure STT finalization time (ms), from `sttFinalizeMs`
   * (LiveKit EOUMetrics.transcription_delay) — isolates STT time from the
   * broader `avgMs`/`p95Ms` end-to-end latency. Null when no turns in this
   * window have the field populated (e.g. pre-rollout data).
   */
  avgSttFinalizeMs: number | null;
}

/**
 * Shared per-session voice-pipeline latency shape — used both for a single
 * session-wise row (`getVoiceLatencyBySessions`, one row per session) and for
 * the whole-filtered-set summary (`getVoiceLatencySessionsSummary`, one row
 * total). Mirrors `RoleplaySessionLatencyRow`
 * (roleplay-session-logs.repository.ts:59-78) minus the deprecated
 * `avgProsodyMs`/`prosodySkippedTurns` fields — keep both in sync if
 * `scenario_session_turn_metrics` gains/loses a column.
 */
export interface VoiceLatencySessionStagesRow {
  avgResponseLatencyMs: number | string | null;
  p50ResponseLatencyMs: number | string | null;
  p95ResponseLatencyMs: number | string | null;
  avgEouDelayMs: number | string | null;
  avgSttFinalizeMs: number | string | null;
  avgLlmTtftMs: number | string | null;
  avgTtsTtfbMs: number | string | null;
  avgOrchestrationMs: number | string | null;
  avgLlmResponseMs: number | string | null;
  avgBranchingMs: number | string | null;
  avgKnowledgeRetrievalMs: number | string | null;
  avgProcessEventsMs: number | string | null;
  avgBehaviorsMs: number | string | null;
  interruptedTurns: number | string;
  llmTimedOutTurns: number | string;
}

export interface VoiceLatencySessionRow extends VoiceLatencySessionStagesRow {
  scenarioSessionId: string;
  occurredAt: string | null;
  turnCount: number | string;
}

export interface VoiceLatencyByScenarioRow extends VoiceLatencySessionStagesRow {
  scenarioId: number;
  scenarioTitle: string;
  sessionCount: number | string;
  turnCount: number | string;
}

/**
 * Defensive cap on {@link PlatformAnalyticsRepository.getVoiceLatencyByScenario} —
 * comfortably above the platform's current scenario count (412 as of
 * 2026-08-19) so nothing real gets cut today, while still bounding payload
 * size if that count grows a lot. The service layer logs + flags
 * `truncated: true` if this is ever actually hit — see
 * platform-analytics.service.ts.
 */
export const VOICE_LATENCY_BY_SCENARIO_LIMIT = 500;

export interface VoiceLatencySessionsSummaryRow extends VoiceLatencySessionStagesRow {
  sessionCount: number | string;
  turnCount: number | string;
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

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
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
          -- No tenant column on this table (webhook writes have no resolved
          -- tenant), so exclude test orgs via the owning session.
          AND ${excludeTestTenantsBySession('l."scenarioSessionId"')}
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
        AND ${excludeTestTenants('ss."tenant_id"')}
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
          AND ${excludeTestTenants('ss."tenant_id"')}
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
      .andWhere(excludeTestTenants('u."tenant_id"'))
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
      .andWhere(excludeTestTenants('u."tenant_id"'))
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Total number of users on the platform. */
  async getTotalUsers(): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .where(excludeTestTenants('u."tenant_id"'))
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
      .andWhere(excludeTestTenants('s."tenant_id"'))
      .getRawMany<{ day: string; counselorId: number }>();

    return rows.map((r) => ({
      day: r.day,
      counselorId: Number(r.counselorId),
    }));
  }

  /**
   * Completed simulations grouped by time bucket within [start, end).
   * Completion timestamp is `COALESCE(endedAt, createdAt)`. `trunc` is
   * whitelisted by resolveBucket.
   *
   * Was week-only, which is why the chart above it was titled "per week"; the
   * grain is now the reader's choice, so neither the query nor the title may
   * assume one.
   */
  async getSimulationsCompletedByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'))
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct active (bucket, counselorId) pairs within [start, end), joined to
   * the user's account creation date so the service can label each active user
   * as "new" (account created in that same bucket) or "returning". Activity
   * timestamp is `COALESCE(startedAt, createdAt)`; `trunc` is whitelisted by
   * resolveBucket.
   *
   * Note that the new/returning split is defined RELATIVE TO THE BUCKET, so it
   * genuinely means something different at each grain — "new this week" and "new
   * this year" are different questions, not the same answer re-binned. The
   * surface names the grain for exactly this reason.
   */
  async getActivePairsWithCreatedAtByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketActiveUserRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."startedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('s."counselorId"', 'counselorId')
      .addSelect(`to_char(u."createdAt", 'YYYY-MM-DD')`, 'userCreatedAt')
      .distinct(true)
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'))
      .getRawMany<{
        bucket: string;
        counselorId: number;
        userCreatedAt: string;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      counselorId: Number(r.counselorId),
      userCreatedAt: r.userCreatedAt,
    }));
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * See {@link getPlatformDataFloor}; kept behind the repository so the service
   * stays free of SQL.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** Distinct user counts grouped by role/group name. */
  async getUsersByRole(): Promise<UsersByRoleRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('g.name', 'role')
      .addSelect('COUNT(DISTINCT ug."userId")::int', 'count')
      .from('user_groups', 'ug')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      // Via the user rather than ug."tenant_id": that column is legacy (added
      // with DEFAULT 'default') and less trustworthy than users.tenant_id.
      .where(excludeTestTenantsByUser('ug."userId"'))
      .groupBy('g.name')
      .orderBy('count', 'DESC')
      .getRawMany<{ role: string; count: number }>();

    return rows.map((r) => ({
      role: r.role,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct users with any session activity in [since, until).
   *
   * `until` is optional so the default call still means "since then, up to now".
   * Passing it makes the count windowed, which is what lets the same query serve
   * as the comparison basis for an equal-length preceding period — without an
   * upper bound, a "previous period" count would silently include the current
   * one and the delta would always trend to zero.
   */
  async getActiveUserCountSince(since: Date, until?: Date): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (until) {
      qb.andWhere('COALESCE(s."startedAt", s."createdAt") < :until', { until });
    }
    const row = await qb.getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct active users in [since, until) whose account predates `since`
   * (i.e. returning users, used for the retention rate).
   */
  async getReturningActiveUserCountSince(
    since: Date,
    until?: Date,
  ): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .andWhere('u."createdAt" < :since', { since })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (until) {
      qb.andWhere('COALESCE(s."startedAt", s."createdAt") < :until', { until });
    }
    const row = await qb.getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Voice-to-voice latency aggregated per time bucket AND per `source`
   * (pipeline vs transcript) within [start, end), over
   * `scenario_session_turn_metrics`. Returns avg / p50 / p95 of
   * `responseLatencyMs` plus the turn count for each (bucket, source) pair.
   *
   * Also returns the per-bucket first-audio split (how many turns were
   * fronted by a filler / interim / the reply itself, their means, and the
   * unmasked time to the real reply) — see the field docs on
   * {@link VoiceLatencyBucketRow}.
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
      // llmTtftMs is live-instrumentation only, so 'transcript' buckets are
      // all-NULL for this column — avg()/percentile_cont() over an all-NULL
      // group already return NULL, matching the existing
      // null-when-unpopulated convention (see avgSttFinalizeMs below).
      .addSelect('round(avg(m."llmTtftMs"))::int', 'avgLlmTtftMs')
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."llmTtftMs"))::int`,
        'p50LlmTtftMs',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."llmTtftMs"))::int`,
        'p95LlmTtftMs',
      )
      // Ratio-of-sums, not average-of-ratios: avoids a handful of
      // tiny-promptTokens turns (e.g. a session's first turn, always 0%
      // since nothing is cached yet) skewing the bucket average. NULL when
      // unpopulated (transcript buckets, or before this was instrumented) —
      // sum() over an all-NULL group already returns NULL, same convention
      // as avgLlmTtftMs above.
      .addSelect(
        `round(100.0 * sum(m."cachedTokens")::numeric / ` +
          `NULLIF(sum(m."promptTokens"), 0))::float`,
        'avgCacheHitRatePct',
      );

    // What spoke first. `responseLatencyMs` is time-to-first-audio, so a
    // filler or interim reply can own it; these counts + per-source means keep
    // "we got faster" and "we masked more" distinguishable. Turns with no
    // recorded provenance are counted separately, never assumed unmasked.
    const firstAudioIs = (kind: string) =>
      `m."metadata"->>'firstAudioSource' = '${kind}'`;
    for (const [kind, alias] of [
      ['filler', 'firstAudioFillerTurns'],
      ['interim', 'firstAudioInterimTurns'],
      ['reply', 'firstAudioReplyTurns'],
    ] as const) {
      qb.addSelect(`COUNT(*) FILTER (WHERE ${firstAudioIs(kind)})::int`, alias);
      qb.addSelect(
        `round(avg(m."responseLatencyMs") FILTER ` +
          `(WHERE ${firstAudioIs(kind)}))::int`,
        `avgFirstAudio${kind[0].toUpperCase()}${kind.slice(1)}Ms`,
      );
    }
    qb.addSelect(
      `COUNT(*) FILTER (WHERE m."metadata"->>'firstAudioSource' IS NULL)::int`,
      'firstAudioUnknownTurns',
    );

    // Unmasked time to the real reply: replyLatencyMs when a filler/interim
    // front-ran it, else the response latency itself (which already IS the
    // reply on unmasked turns). jsonb_typeof guards the cast so one
    // malformed metadata value cannot fail the whole query.
    const replyLatencyExpr =
      `COALESCE(CASE WHEN jsonb_typeof(m."metadata"->'replyLatencyMs') = 'number' ` +
      `THEN (m."metadata"->>'replyLatencyMs')::numeric END, ` +
      `m."responseLatencyMs")`;
    const instrumented = `m."metadata"->>'firstAudioSource' IS NOT NULL`;
    qb.addSelect(
      `round(avg(${replyLatencyExpr}) FILTER (WHERE ${instrumented}))::int`,
      'avgReplyLatencyMs',
    );
    for (const [q, alias] of [
      ['0.5', 'p50ReplyLatencyMs'],
      ['0.95', 'p95ReplyLatencyMs'],
    ] as const) {
      qb.addSelect(
        `round(percentile_cont(${q}) WITHIN GROUP (ORDER BY ${replyLatencyExpr}) ` +
          `FILTER (WHERE ${instrumented}))::int`,
        alias,
      );
    }

    qb.from('scenario_session_turn_metrics', 'm');
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
      .andWhere('m."responseLatencyMs" IS NOT NULL')
      .andWhere(excludeTestTenants('m."tenant_id"'));
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
        avgLlmTtftMs: number | null;
        p50LlmTtftMs: number | null;
        p95LlmTtftMs: number | null;
        avgCacheHitRatePct: number | null;
        firstAudioFillerTurns: number;
        firstAudioInterimTurns: number;
        firstAudioReplyTurns: number;
        firstAudioUnknownTurns: number;
        avgFirstAudioFillerMs: number | null;
        avgFirstAudioInterimMs: number | null;
        avgFirstAudioReplyMs: number | null;
        avgReplyLatencyMs: number | null;
        p50ReplyLatencyMs: number | null;
        p95ReplyLatencyMs: number | null;
      }>();

    // llmTtft* are left as null (not coerced to 0) when unpopulated for the
    // bucket — same "no meaningful zero" rule as the rest of this file.
    const toNullableNumber = (v: number | null): number | null =>
      v == null ? null : Number(v);

    return rows.map((r) => ({
      bucket: r.bucket,
      source: r.source,
      turns: Number(r.turns) || 0,
      avgMs: Number(r.avgMs) || 0,
      p50Ms: Number(r.p50Ms) || 0,
      p95Ms: Number(r.p95Ms) || 0,
      avgLlmTtftMs: toNullableNumber(r.avgLlmTtftMs),
      p50LlmTtftMs: toNullableNumber(r.p50LlmTtftMs),
      p95LlmTtftMs: toNullableNumber(r.p95LlmTtftMs),
      avgCacheHitRatePct: toNullableNumber(r.avgCacheHitRatePct),
      // Counts are real zeros (no turns of that kind), so they coerce to 0 —
      // unlike the latencies beside them, which stay null when unpopulated.
      firstAudioFillerTurns: Number(r.firstAudioFillerTurns) || 0,
      firstAudioInterimTurns: Number(r.firstAudioInterimTurns) || 0,
      firstAudioReplyTurns: Number(r.firstAudioReplyTurns) || 0,
      firstAudioUnknownTurns: Number(r.firstAudioUnknownTurns) || 0,
      avgFirstAudioFillerMs: toNullableNumber(r.avgFirstAudioFillerMs),
      avgFirstAudioInterimMs: toNullableNumber(r.avgFirstAudioInterimMs),
      avgFirstAudioReplyMs: toNullableNumber(r.avgFirstAudioReplyMs),
      avgReplyLatencyMs: toNullableNumber(r.avgReplyLatencyMs),
      p50ReplyLatencyMs: toNullableNumber(r.p50ReplyLatencyMs),
      p95ReplyLatencyMs: toNullableNumber(r.p95ReplyLatencyMs),
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
      .addSelect('round(avg(m."sttFinalizeMs"))::int', 'avgSttFinalizeMs')
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
      .andWhere(excludeTestTenants('m."tenant_id"'))
      .groupBy(`COALESCE(l."value", 'en')`)
      .orderBy(`COALESCE(l."value", 'en')`, 'ASC')
      .getRawMany<{
        language: string;
        turns: number;
        avgMs: number;
        p95Ms: number;
        avgSttFinalizeMs: number | null;
      }>();

    return rows.map((r) => ({
      language: r.language,
      turns: Number(r.turns) || 0,
      avgMs: Number(r.avgMs) || 0,
      p95Ms: Number(r.p95Ms) || 0,
      avgSttFinalizeMs:
        r.avgSttFinalizeMs != null ? Number(r.avgSttFinalizeMs) : null,
    }));
  }

  /**
   * Every simulation with at least one live-pipeline turn in the window,
   * worst-first (`avgResponseLatencyMs DESC`) — "which simulations are slow"
   * as its own question, distinct from {@link getVoiceLatencyBySessions}
   * ("show me THIS simulation's worst sessions, once I already suspect it").
   * Same stage SELECT-list as that method (kept in sync — see its own
   * doc-comment), so a slow scenario's per-stage columns point at *why*
   * without a second query. `m."scenarioId"` is reliably populated/indexed
   * (unlike the sparse `m."language"`), so this joins straight to
   * `scenarios` for a title rather than hopping through `scenario_sessions`
   * the way the language join does. Capped at
   * {@link VOICE_LATENCY_BY_SCENARIO_LIMIT} — see that constant's doc-comment.
   */
  async getVoiceLatencyByScenario(
    start: Date,
    end: Date,
    language?: string,
  ): Promise<VoiceLatencyByScenarioRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .from('scenario_session_turn_metrics', 'm')
      .innerJoin('scenarios', 'sc', 'sc.id = m."scenarioId"');
    if (language) {
      qb.innerJoin(
        'scenario_sessions',
        'ss',
        'ss.id = m."scenarioSessionId"',
      ).leftJoin(
        'languages',
        'l',
        `l.id = NULLIF(ss.metadata->>'languageId', '')::int`,
      );
    }
    qb.where('m."occurredAt" >= :start', { start })
      .andWhere('m."occurredAt" < :end', { end })
      .andWhere(`m."source" = 'pipeline'`)
      .andWhere('m."responseLatencyMs" IS NOT NULL')
      .andWhere(excludeTestTenants('m."tenant_id"'));
    if (language) {
      qb.andWhere(`COALESCE(l."value", 'en') = :language`, { language });
    }
    qb.select('m."scenarioId"', 'scenarioId')
      .addSelect('sc.title', 'scenarioTitle')
      .addSelect('COUNT(DISTINCT m."scenarioSessionId")::int', 'sessionCount')
      .addSelect('COUNT(*)::int', 'turnCount')
      .addSelect(
        'round(avg(m."responseLatencyMs"))::int',
        'avgResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p50ResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95ResponseLatencyMs',
      )
      .addSelect('round(avg(m."eouDelayMs"))::int', 'avgEouDelayMs')
      .addSelect('round(avg(m."sttFinalizeMs"))::int', 'avgSttFinalizeMs')
      .addSelect('round(avg(m."llmTtftMs"))::int', 'avgLlmTtftMs')
      .addSelect('round(avg(m."ttsTtfbMs"))::int', 'avgTtsTtfbMs')
      .addSelect('round(avg(m."orchestrationMs"))::int', 'avgOrchestrationMs')
      .addSelect('round(avg(m."llmResponseMs"))::int', 'avgLlmResponseMs')
      .addSelect('round(avg(m."branchingMs"))::int', 'avgBranchingMs')
      .addSelect(
        'round(avg(m."knowledgeRetrievalMs"))::int',
        'avgKnowledgeRetrievalMs',
      )
      .addSelect('round(avg(m."processEventsMs"))::int', 'avgProcessEventsMs')
      .addSelect('round(avg(m."behaviorsMs"))::int', 'avgBehaviorsMs')
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."interrupted" THEN 1 ELSE 0 END), 0)::int',
        'interruptedTurns',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."llmTimedOut" THEN 1 ELSE 0 END), 0)::int',
        'llmTimedOutTurns',
      )
      .groupBy('m."scenarioId"')
      .addGroupBy('sc.title')
      .orderBy('avg(m."responseLatencyMs")', 'DESC', 'NULLS LAST')
      .addOrderBy('m."scenarioId"', 'ASC')
      .limit(VOICE_LATENCY_BY_SCENARIO_LIMIT);

    return qb.getRawMany<VoiceLatencyByScenarioRow>();
  }

  /**
   * Shared filters for the session-wise voice-latency queries below (list,
   * count, summary) so all three stay in lockstep — mirrors the
   * `applyFilters` convention in roleplay-session-logs.repository.ts, extended
   * to a list/count/summary triple instead of a list/count pair. Assumes the
   * query builder already has `FROM scenario_session_turn_metrics m` and,
   * when `language` is set, a `LEFT JOIN languages l ON l.id =
   * NULLIF(ss.metadata->>'languageId','')::int` (via `ss` = `scenario_sessions`).
   * `m."scenarioId"` is reliably populated at write time (unlike `m."language"`,
   * which is largely unpopulated) so the scenario filter needs no join.
   */
  private applyVoiceLatencySessionFilters(
    qb: SelectQueryBuilder<ObjectLiteral>,
    filters: { scenarioId: number; language?: string; start: Date; end: Date },
  ): void {
    qb.where('m."scenarioId" = :scenarioId', {
      scenarioId: filters.scenarioId,
    })
      .andWhere('m."occurredAt" >= :start', { start: filters.start })
      .andWhere('m."occurredAt" < :end', { end: filters.end })
      .andWhere(`m."source" = 'pipeline'`)
      .andWhere(excludeTestTenants('m."tenant_id"'));
    if (filters.language) {
      qb.andWhere(`COALESCE(l."value", 'en') = :language`, {
        language: filters.language,
      });
    }
  }

  /**
   * Session-wise voice latency for one simulation: one row per session,
   * averaging that session's turns across every pipeline stage. Sorted
   * worst-first (`avgResponseLatencyMs DESC`) since this exists to help spot
   * outlier sessions, not browse chronologically. The stage SELECT-list is
   * copied from `RoleplaySessionLogsRepository.getLatencyBySession`
   * (roleplay-session-logs.repository.ts:596-636) — that method computes the
   * same breakdown for a single known session id; this one groups it across
   * every session matching a scenario(+language) filter, paginated. Keep both
   * in sync if `scenario_session_turn_metrics` gains/loses a column.
   */
  async getVoiceLatencyBySessions(
    scenarioId: number,
    language: string | undefined,
    start: Date,
    end: Date,
    limit: number,
    offset: number,
  ): Promise<{ rows: VoiceLatencySessionRow[]; total: number }> {
    const buildBase = () => {
      const qb = this.dataSource
        .createQueryBuilder()
        .from('scenario_session_turn_metrics', 'm')
        .innerJoin('scenario_sessions', 'ss', 'ss.id = m."scenarioSessionId"');
      if (language) {
        qb.leftJoin(
          'languages',
          'l',
          `l.id = NULLIF(ss.metadata->>'languageId', '')::int`,
        );
      }
      this.applyVoiceLatencySessionFilters(qb, {
        scenarioId,
        language,
        start,
        end,
      });
      return qb;
    };

    const rowsQb = buildBase()
      .select('m."scenarioSessionId"', 'scenarioSessionId')
      .addSelect('MIN(ss."startedAt")', 'occurredAt')
      .addSelect('COUNT(*)::int', 'turnCount')
      .addSelect(
        'round(avg(m."responseLatencyMs"))::int',
        'avgResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p50ResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95ResponseLatencyMs',
      )
      .addSelect('round(avg(m."eouDelayMs"))::int', 'avgEouDelayMs')
      .addSelect('round(avg(m."sttFinalizeMs"))::int', 'avgSttFinalizeMs')
      .addSelect('round(avg(m."llmTtftMs"))::int', 'avgLlmTtftMs')
      .addSelect('round(avg(m."ttsTtfbMs"))::int', 'avgTtsTtfbMs')
      .addSelect('round(avg(m."orchestrationMs"))::int', 'avgOrchestrationMs')
      .addSelect('round(avg(m."llmResponseMs"))::int', 'avgLlmResponseMs')
      .addSelect('round(avg(m."branchingMs"))::int', 'avgBranchingMs')
      .addSelect(
        'round(avg(m."knowledgeRetrievalMs"))::int',
        'avgKnowledgeRetrievalMs',
      )
      .addSelect('round(avg(m."processEventsMs"))::int', 'avgProcessEventsMs')
      .addSelect('round(avg(m."behaviorsMs"))::int', 'avgBehaviorsMs')
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."interrupted" THEN 1 ELSE 0 END), 0)::int',
        'interruptedTurns',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."llmTimedOut" THEN 1 ELSE 0 END), 0)::int',
        'llmTimedOutTurns',
      )
      .groupBy('m."scenarioSessionId"')
      .orderBy('avg(m."responseLatencyMs")', 'DESC', 'NULLS LAST')
      .addOrderBy('m."scenarioSessionId"', 'ASC')
      .limit(limit)
      .offset(offset);

    const countQb = buildBase().select(
      'COUNT(DISTINCT m."scenarioSessionId")::int',
      'total',
    );

    const [rows, countRow] = await Promise.all([
      rowsQb.getRawMany<VoiceLatencySessionRow>(),
      countQb.getRawOne<{ total: number }>(),
    ]);

    return { rows, total: Number(countRow?.total) || 0 };
  }

  /**
   * Overall average across EVERY session matching the scenario(+language)
   * filter — deliberately a separate query from {@link getVoiceLatencyBySessions}
   * rather than an aggregate of the current page, since the page is only a
   * slice (25 of possibly hundreds of sessions) and averaging just that slice
   * would silently misrepresent the scenario's real average. Per-turn
   * weighted (each turn counted once), matching how every other latency
   * aggregate in this file already averages — not an "average of per-session
   * averages."
   */
  async getVoiceLatencySessionsSummary(
    scenarioId: number,
    language: string | undefined,
    start: Date,
    end: Date,
  ): Promise<VoiceLatencySessionsSummaryRow> {
    const qb = this.dataSource
      .createQueryBuilder()
      .from('scenario_session_turn_metrics', 'm')
      .innerJoin('scenario_sessions', 'ss', 'ss.id = m."scenarioSessionId"');
    if (language) {
      qb.leftJoin(
        'languages',
        'l',
        `l.id = NULLIF(ss.metadata->>'languageId', '')::int`,
      );
    }
    this.applyVoiceLatencySessionFilters(qb, {
      scenarioId,
      language,
      start,
      end,
    });
    qb.select('COUNT(DISTINCT m."scenarioSessionId")::int', 'sessionCount')
      .addSelect('COUNT(*)::int', 'turnCount')
      .addSelect(
        'round(avg(m."responseLatencyMs"))::int',
        'avgResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p50ResponseLatencyMs',
      )
      .addSelect(
        `round(percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY m."responseLatencyMs"))::int`,
        'p95ResponseLatencyMs',
      )
      .addSelect('round(avg(m."eouDelayMs"))::int', 'avgEouDelayMs')
      .addSelect('round(avg(m."sttFinalizeMs"))::int', 'avgSttFinalizeMs')
      .addSelect('round(avg(m."llmTtftMs"))::int', 'avgLlmTtftMs')
      .addSelect('round(avg(m."ttsTtfbMs"))::int', 'avgTtsTtfbMs')
      .addSelect('round(avg(m."orchestrationMs"))::int', 'avgOrchestrationMs')
      .addSelect('round(avg(m."llmResponseMs"))::int', 'avgLlmResponseMs')
      .addSelect('round(avg(m."branchingMs"))::int', 'avgBranchingMs')
      .addSelect(
        'round(avg(m."knowledgeRetrievalMs"))::int',
        'avgKnowledgeRetrievalMs',
      )
      .addSelect('round(avg(m."processEventsMs"))::int', 'avgProcessEventsMs')
      .addSelect('round(avg(m."behaviorsMs"))::int', 'avgBehaviorsMs')
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."interrupted" THEN 1 ELSE 0 END), 0)::int',
        'interruptedTurns',
      )
      .addSelect(
        'COALESCE(SUM(CASE WHEN m."llmTimedOut" THEN 1 ELSE 0 END), 0)::int',
        'llmTimedOutTurns',
      );

    const row = await qb.getRawOne<VoiceLatencySessionsSummaryRow>();
    return (
      row ?? {
        sessionCount: 0,
        turnCount: 0,
        avgResponseLatencyMs: null,
        p50ResponseLatencyMs: null,
        p95ResponseLatencyMs: null,
        avgEouDelayMs: null,
        avgSttFinalizeMs: null,
        avgLlmTtftMs: null,
        avgTtsTtfbMs: null,
        avgOrchestrationMs: null,
        avgLlmResponseMs: null,
        avgBranchingMs: null,
        avgKnowledgeRetrievalMs: null,
        avgProcessEventsMs: null,
        avgBehaviorsMs: null,
        interruptedTurns: 0,
        llmTimedOutTurns: 0,
      }
    );
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
      .andWhere('m."startLatencyMs" IS NOT NULL')
      .andWhere(excludeTestTenants('m."tenant_id"'));
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

  /**
   * Completed simulations in [since, until) — `until` optional, so the default
   * call still means "since then, up to now" and a bounded call can serve as the
   * comparison basis for a preceding period.
   */
  async getCompletedSimsSince(since: Date, until?: Date): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :since', { since })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (until) {
      qb.andWhere('COALESCE(s."endedAt", s."createdAt") < :until', { until });
    }
    const row = await qb.getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }
}
