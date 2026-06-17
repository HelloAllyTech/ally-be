import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';

/**
 * Bucket granularity for time-series aggregation. Controlled internally by the
 * service (never user input) so it is safe to interpolate into `date_trunc`.
 */
export type AnalyticsBucket = 'day' | 'week' | 'month';

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

/** Shared filters for conversation-drift analytics queries. */
export interface DriftFilters {
  start: Date;
  end: Date;
  language?: string;
  scenarioId?: number;
  llmModel?: string;
  llmProvider?: string;
  promptVersion?: string;
}

export interface DriftRateRow {
  language: string;
  totalSessions: number;
  driftedSessions: number;
}

/** Drift rate grouped by an experiment dimension (model / provider / prompt version). */
export interface DriftDimensionRow {
  key: string;
  totalSessions: number;
  driftedSessions: number;
}

export interface DriftCountRow {
  /** category value (topic / coherence / attribution / failure / STT). */
  key: string;
  /** number of distinct sessions that had >=1 turn in this category. */
  count: number;
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
  ): Promise<VoiceLatencyBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
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
      .from('scenario_session_turn_metrics', 'm')
      .where('m."occurredAt" >= :start', { start })
      .andWhere('m."occurredAt" < :end', { end })
      .andWhere('m."responseLatencyMs" IS NOT NULL')
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

  // ---------------------------------------------------------------------
  // Conversation drift analytics (over turn_drift_judgment).
  // ---------------------------------------------------------------------

  /**
   * Apply the shared drift filters (time window on the session time +
   * experiment slice dimensions) to a raw query on turn_drift_judgment aliased
   * 'j'. Time uses COALESCE(occurredAt, createdAt): occurredAt is the session
   * timestamp set by the runner; createdAt is the fallback for rows judged
   * before occurredAt was populated.
   */
  private applyDriftFilters(
    qb: import('typeorm').SelectQueryBuilder<import('typeorm').ObjectLiteral>,
    f: DriftFilters,
  ) {
    // Window on the SESSION's time (occurredAt), not the judgment's createdAt —
    // otherwise a backfill (which judges historic sessions today) would stamp
    // them all as "now" and pile them into the wrong date bucket. occurredAt is
    // populated by the runner from the session timestamp; COALESCE keeps older
    // rows (judged before occurredAt was set) working off createdAt.
    qb.where('COALESCE(j."occurredAt", j."createdAt") >= :start', {
      start: f.start,
    }).andWhere('COALESCE(j."occurredAt", j."createdAt") < :end', {
      end: f.end,
    });
    if (f.language)
      qb.andWhere('j."language" = :language', { language: f.language });
    if (f.scenarioId != null)
      qb.andWhere('j."scenarioId" = :scenarioId', { scenarioId: f.scenarioId });
    if (f.llmModel)
      qb.andWhere('j."llmModel" = :llmModel', { llmModel: f.llmModel });
    if (f.llmProvider)
      qb.andWhere('j."llmProvider" = :provider', { provider: f.llmProvider });
    if (f.promptVersion)
      qb.andWhere('j."promptVersion" = :pv', { pv: f.promptVersion });
    return qb;
  }

  /** Drifted vs total sessions per language (the primary drift KPI). */
  async getDriftRateByLanguage(f: DriftFilters): Promise<DriftRateRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."language"', 'language')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .groupBy('j."language"')
      .orderBy('j."language"', 'ASC')
      .getRawMany<{
        language: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      language: r.language ?? 'unknown',
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
    }));
  }

  /**
   * Drifted vs total sessions grouped by an experiment dimension — the LLM
   * model, inference provider, or prompt version that produced the session.
   * `dimension` is whitelisted (never raw user input) before interpolation.
   * NULL keys (e.g. sessions judged before generation-config capture landed)
   * surface as 'unknown' so they're visible rather than silently dropped.
   */
  async getDriftRateByDimension(
    f: DriftFilters,
    dimension: 'llmModel' | 'llmProvider' | 'promptVersion',
  ): Promise<DriftDimensionRow[]> {
    const col = {
      llmModel: 'llmModel',
      llmProvider: 'llmProvider',
      promptVersion: 'promptVersion',
    }[dimension];
    const qb = this.dataSource
      .createQueryBuilder()
      .select(`COALESCE(j."${col}", 'unknown')`, 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .groupBy('key')
      .orderBy('"driftedSessions"', 'DESC')
      .getRawMany<{
        key: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      key: r.key ?? 'unknown',
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
    }));
  }

  /**
   * Sessions by root attribution (STT vs LLM vs cascade vs context). With
   * `driftedOnly`, restricts to sessions the rollup flagged as drifted — the
   * correct scope for "what caused the drift", so it agrees with the drift KPI.
   */
  async getDriftAttributionMix(
    f: DriftFilters,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."rootAttribution"', 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    const rows = await qb
      .andWhere('j."rootAttribution" IS NOT NULL')
      .andWhere(`j."rootAttribution" <> 'none'`)
      .groupBy('j."rootAttribution"')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Sessions with >=1 turn of each AI failure mode (what specifically broke).
   * `driftedOnly` restricts to drifted sessions (consistent with the KPI).
   */
  async getDriftFailureModeBreakdown(
    f: DriftFilters,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."aiReplyFailureMode"', 'key')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    const rows = await qb
      .andWhere('j."aiReplyFailureMode" IS NOT NULL')
      .andWhere(`j."aiReplyFailureMode" <> 'none'`)
      .groupBy('j."aiReplyFailureMode"')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Generic drift-turn counts grouped by a whitelisted per-turn dimension:
   * topic label (on/tangent/off/gibberish), coherence level, STT garble
   * severity (none/partial/severe), or STT error type. `excludeNone` drops the
   * 'none' bucket — used for sttErrorType (where 'none' = "not garbled" and
   * isn't informative); kept for garble severity, where none/partial/severe is
   * the whole point.
   */
  async getDriftSessionCountsBy(
    f: DriftFilters,
    dimension:
      | 'topicLabel'
      | 'coherence'
      | 'counselorUtteranceGarbled'
      | 'sttErrorType',
    excludeNone = false,
    driftedOnly = false,
  ): Promise<DriftCountRow[]> {
    const col = {
      topicLabel: 'topicLabel',
      coherence: 'coherence',
      counselorUtteranceGarbled: 'counselorUtteranceGarbled',
      sttErrorType: 'sttErrorType',
    }[dimension];
    const qb = this.dataSource
      .createQueryBuilder()
      .select(`j."${col}"`, 'key')
      // Distinct sessions touched by each category. Sessions can span multiple
      // categories (different turns), so these counts overlap and don't sum to
      // total sessions — render as bars, not a pie.
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'count')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    // Drift KINDS (topic/coherence) describe drifted sessions, so scope to the
    // rollup. STT input-quality (garble/error-type) is independent of drift and
    // is queried with driftedOnly=false.
    if (driftedOnly) qb.andWhere('j."sessionDrifted" = true');
    qb.andWhere(`j."${col}" IS NOT NULL`);
    if (excludeNone) qb.andWhere(`j."${col}" <> 'none'`);
    const rows = await qb
      .groupBy(`j."${col}"`)
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();
    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Distribution of the turn at which drift first began, across drifted
   * sessions ("after the nth utterance"). One count per session (firstDriftTurn
   * is the rollup, denormalized onto every turn row, so DISTINCT session).
   */
  async getFirstDriftTurnHistogram(
    f: DriftFilters,
  ): Promise<{ turn: number; sessions: number }[]> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('j."firstDriftTurn"', 'turn')
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'sessions')
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .andWhere('j."sessionDrifted" = true')
      .andWhere('j."firstDriftTurn" IS NOT NULL')
      .groupBy('j."firstDriftTurn"')
      .orderBy('j."firstDriftTurn"', 'ASC')
      .getRawMany<{ turn: number; sessions: number }>();
    return rows.map((r) => ({
      turn: Number(r.turn),
      sessions: Number(r.sessions) || 0,
    }));
  }

  /**
   * Drift rate over time — drifted vs total sessions per day/week/month bucket
   * on the session time (COALESCE occurredAt/createdAt). The "is drift getting
   * better?" trend.
   */
  async getDriftTrend(
    f: DriftFilters,
    bucket: AnalyticsBucket,
  ): Promise<
    { bucket: string; totalSessions: number; driftedSessions: number }[]
  > {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(j."occurredAt", j."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(DISTINCT j."scenarioSessionId")::int', 'totalSessions')
      .addSelect(
        'COUNT(DISTINCT j."scenarioSessionId") FILTER (WHERE j."sessionDrifted" = true)::int',
        'driftedSessions',
      )
      .from('turn_drift_judgment', 'j');
    this.applyDriftFilters(qb, f);
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        totalSessions: number;
        driftedSessions: number;
      }>();
    return rows.map((r) => ({
      bucket: r.bucket,
      totalSessions: Number(r.totalSessions) || 0,
      driftedSessions: Number(r.driftedSessions) || 0,
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
