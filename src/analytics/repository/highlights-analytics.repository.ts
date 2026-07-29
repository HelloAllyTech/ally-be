import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
import { QuizAttemptStatus } from '../../track/type/quiz.type';
import { AnalyticsBucket } from './platform-analytics.repository';
import {
  excludeTestTenants,
  excludeTestTenantsByUser,
  scopeToTenant,
  scopeToTenantByUser,
} from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

export interface TopOrgRow {
  tenantId: string;
  tenantName: string;
  completedSimulations: number;
}

/**
 * Smallest activity count an org may be NAMED at.
 *
 * A per-org breakdown is a breakdown of people: an org with two completed
 * simulations in the window is one or two identifiable learners, so naming it
 * alongside a score or a volume re-identifies them to anyone who knows the org.
 * Orgs below the floor are aggregated into a single unnamed "Other orgs" row by
 * the service, which keeps the total honest without exposing the tail.
 */
export const MIN_ORG_GROUP_SIZE = 5;

export interface PracticeMinutesBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  minutes: number;
  activeLearners: number;
}

export interface PlayTimeBucketRow {
  bucket: string;
  /** Mean session length in minutes. Null is impossible here — see the query. */
  avgMinutes: number;
  /** Median session length in minutes. */
  medianMinutes: number;
  /** 95th-percentile session length in minutes. */
  p95Minutes: number;
  /** Sessions behind the bucket's figures. */
  sessions: number;
}

export interface QualityTrendBucketRow {
  bucket: string;
  avgCompositeScore: number | null;
  evaluatedSessions: number;
}

export interface CsatTrendBucketRow {
  bucket: string;
  avgRating: number | null;
  responses: number;
}

export interface TrackFunnelCounts {
  enrolled: number;
  started: number;
  completed: number;
}

export interface QuizPassCounts {
  attempts: number;
  passed: number;
}

export interface CompletedSimsBucketRow {
  bucket: string;
  count: number;
}

export interface AiUsageBucketRow {
  bucket: string;
  service: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  audioMs: number;
  characters: number;
  calls: number;
}

/**
 * Raw aggregations for the leadership "Highlights" tab. Mirrors
 * PlatformAnalyticsRepository: a `DataSource`-backed query builder over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), truncated dates out as `yyyy-mm-dd` strings, counts cast
 * `::int` and re-parsed defensively. Platform-wide (super-admin) by design.
 *
 * "Completed simulation" here mirrors getSimulationsCompletedByWeek exactly
 * (eventStatus = COMPLETED, timestamped by COALESCE(endedAt, createdAt), no
 * roomId filter) so Highlights reconciles 1:1 with the Overview tab.
 *
 * Most methods accept an optional `tenantId` to narrow to one org. Two do not,
 * and deliberately:
 *   - {@link getAiUsageByBucket} — most `llm_usage` rows are tenantless by
 *     design (judges, autofill, translation), so a tenant-filtered cost figure
 *     would silently report a fraction of real spend. AI cost stays a platform
 *     number and the response flags it as unscoped.
 *   - {@link getActiveOrgCount} / {@link getTopOrgsByCompletedSims} — counting
 *     and ranking orgs is inherently cross-org; narrowing to one makes the
 *     question meaningless rather than answering it differently.
 */
@Injectable()
export class HighlightsAnalyticsRepository {
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
   * Where the platform's data begins — the left edge of an all-time window.
   * See {@link getPlatformDataFloor}. Deliberately the same measurement the
   * overview endpoint uses, so the two responses that this tab composes cover
   * the same period rather than two axes that nearly line up.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** Distinct orgs with >=1 completed simulation in [start, end). */
  async getActiveOrgCount(start: Date, end: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."tenant_id")::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'))
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Top orgs by completed simulations in [start, end), with tenant name.
   * `scenario_sessions.tenant_id` is a VARCHAR that holds tenant uuids in real
   * environments but tenant CODES (e.g. 'ally') in seed data — so the uuid side
   * is cast to text (casting the varchar to uuid would throw) and the code is
   * tried as a fallback join key. Aggregate first so the join touches <= limit
   * rows; unresolvable tenants stay visible under their raw id.
   *
   * Only orgs at or above {@link MIN_ORG_GROUP_SIZE} are returned; the caller
   * gets `belowFloor` so it can render the remainder as one unnamed row rather
   * than dropping it and understating the total.
   */
  async getTopOrgsByCompletedSims(
    start: Date,
    end: Date,
    limit = 10,
  ): Promise<{
    rows: TopOrgRow[];
    belowFloor: { orgs: number; sims: number };
  }> {
    const rows = await this.dataSource.query(
      `
      WITH agg AS (
        SELECT s."tenant_id" AS tenant_id, COUNT(*)::int AS completed
        FROM scenario_sessions s
        WHERE s."eventStatus" = $3
          AND COALESCE(s."endedAt", s."createdAt") >= $1
          AND COALESCE(s."endedAt", s."createdAt") < $2
          AND ${excludeTestTenants('s."tenant_id"')}
        GROUP BY s."tenant_id"
      ),
      named AS (
        SELECT * FROM agg WHERE completed >= $4 ORDER BY completed DESC LIMIT $5
      )
      SELECT
        named.tenant_id                   AS "tenantId",
        COALESCE(t.name, named.tenant_id) AS "tenantName",
        named.completed                   AS "completedSimulations",
        (SELECT COUNT(*)::int FROM agg WHERE completed < $4)      AS "belowFloorOrgs",
        (SELECT COALESCE(SUM(completed), 0)::int FROM agg
          WHERE completed < $4)                                   AS "belowFloorSims"
      FROM named
      LEFT JOIN tenants t
        ON (t.id::text = named.tenant_id OR t.code = named.tenant_id)
       AND t."deletedAt" IS NULL
      ORDER BY named.completed DESC
      `,
      [
        start,
        end,
        ScenarioSessionEventStatus.COMPLETED,
        MIN_ORG_GROUP_SIZE,
        limit,
      ],
    );

    // The below-floor totals are window-level constants repeated on every row;
    // when no org clears the floor there are no rows, so re-derive them.
    const first = (rows[0] ?? {}) as Record<string, unknown>;
    const belowFloor = rows.length
      ? {
          orgs: Number(first.belowFloorOrgs) || 0,
          sims: Number(first.belowFloorSims) || 0,
        }
      : await this.getBelowFloorTotals(start, end);

    return {
      rows: rows.map((r: Record<string, unknown>) => ({
        tenantId: r.tenantId as string,
        tenantName: r.tenantName as string,
        completedSimulations: Number(r.completedSimulations) || 0,
      })),
      belowFloor,
    };
  }

  /** Below-floor org/sim totals, for the case where no org clears the floor. */
  private async getBelowFloorTotals(
    start: Date,
    end: Date,
  ): Promise<{ orgs: number; sims: number }> {
    const rows = await this.dataSource.query(
      `
      WITH agg AS (
        SELECT s."tenant_id" AS tenant_id, COUNT(*)::int AS completed
        FROM scenario_sessions s
        WHERE s."eventStatus" = $3
          AND COALESCE(s."endedAt", s."createdAt") >= $1
          AND COALESCE(s."endedAt", s."createdAt") < $2
          AND ${excludeTestTenants('s."tenant_id"')}
        GROUP BY s."tenant_id"
      )
      SELECT
        COUNT(*)::int                          AS orgs,
        COALESCE(SUM(completed), 0)::int       AS sims
      FROM agg WHERE completed < $4
      `,
      [start, end, ScenarioSessionEventStatus.COMPLETED, MIN_ORG_GROUP_SIZE],
    );
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return { orgs: Number(r.orgs) || 0, sims: Number(r.sims) || 0 };
  }

  /**
   * Minutes practiced + distinct active learners per bucket from the
   * pre-aggregated `user_daily_scores` table. `date` is a DATE column, so
   * `date_trunc` is pure calendar math (matches the service's UTC axis).
   * `minutesPlayed` is decimal(10,2) — pg returns strings, hence Number().
   */
  async getPracticeMinutesByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<PracticeMinutesBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', d."date"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COALESCE(SUM(d."minutesPlayed"), 0)::float', 'minutes')
      .addSelect('COUNT(DISTINCT d."userId")::int', 'activeLearners')
      .from('user_daily_scores', 'd')
      .where('d."date" >= :start', { start })
      .andWhere('d."date" < :end', { end })
      .andWhere(excludeTestTenants('d."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('d."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        minutes: number;
        activeLearners: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      minutes: Number(r.minutes) || 0,
      activeLearners: Number(r.activeLearners) || 0,
    }));
  }

  /**
   * How long a simulation actually lasts, per bucket: mean, median and p95
   * session length in minutes, plus the session count behind them.
   *
   * Distinct from {@link getPracticeMinutesByBucket}, which is the TOTAL time
   * the platform was used — that one rises when more people practise, this one
   * only moves when a single sitting gets longer or shorter. Roughly, practice
   * minutes = this mean x completed simulations.
   *
   * Median and p95 travel with the mean because session length is skewed: a
   * handful of very long sittings pull an average away from the typical
   * session, and an average with no distribution behind it is a half-truth.
   * The mean is the subject; the other two say how much to trust it.
   *
   * Definition, deliberately identical to the tab's "completed simulation" so
   * the two charts reconcile: `eventStatus = COMPLETED`, timestamped by
   * `COALESCE(endedAt, createdAt)`. Duration is the persisted
   * `scenario_session_details."callDuration"` (seconds, already net of paused
   * time) — the same figure that feeds `user_daily_scores.minutesPlayed`, so
   * this chart and the practice-minutes chart cannot disagree about what a
   * minute of practice is.
   *
   * Sessions with a NULL or non-positive duration are excluded rather than
   * counted as zero: a session that produced no measurable time is a session
   * that did not happen, and averaging it in would report a fall in engagement
   * whenever the failure rate rose.
   *
   * Buckets with no completed sessions are ABSENT, not zero — an average has no
   * meaningful zero.
   */
  async getPlayTimeByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<PlayTimeBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect(
        'round((avg(d."callDuration") / 60.0)::numeric, 1)::float',
        'avgMinutes',
      )
      .addSelect(
        `round((percentile_cont(0.5) WITHIN GROUP ` +
          `(ORDER BY d."callDuration") / 60.0)::numeric, 1)::float`,
        'medianMinutes',
      )
      .addSelect(
        `round((percentile_cont(0.95) WITHIN GROUP ` +
          `(ORDER BY d."callDuration") / 60.0)::numeric, 1)::float`,
        'p95Minutes',
      )
      .addSelect('COUNT(*)::int', 'sessions')
      .from('scenario_sessions', 's')
      .innerJoin(
        'scenario_session_details',
        'd',
        'd."scenarioSessionId" = s.id',
      )
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('d."callDuration" IS NOT NULL')
      .andWhere('d."callDuration" > 0')
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        avgMinutes: number;
        medianMinutes: number;
        p95Minutes: number;
        sessions: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      avgMinutes: Number(r.avgMinutes) || 0,
      medianMinutes: Number(r.medianMinutes) || 0,
      p95Minutes: Number(r.p95Minutes) || 0,
      sessions: Number(r.sessions) || 0,
    }));
  }

  /**
   * Whole-window mean session length + session count (the exact KPI).
   *
   * Computed over the raw sessions rather than re-averaged from the buckets: a
   * mean of per-bucket means weights a quiet Sunday the same as a busy Monday.
   */
  async getPlayTimeOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<{ avgMinutes: number | null; sessions: number }> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        'round((avg(d."callDuration") / 60.0)::numeric, 1)::float',
        'avgMinutes',
      )
      .addSelect('COUNT(*)::int', 'sessions')
      .from('scenario_sessions', 's')
      .innerJoin(
        'scenario_session_details',
        'd',
        'd."scenarioSessionId" = s.id',
      )
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('d."callDuration" IS NOT NULL')
      .andWhere('d."callDuration" > 0')
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{
      avgMinutes: number | null;
      sessions: number;
    }>();

    return {
      avgMinutes: row?.avgMinutes == null ? null : Number(row.avgMinutes),
      sessions: Number(row?.sessions) || 0,
    };
  }

  /**
   * Mean composite evaluation score (0-100) + evaluated-session count per
   * bucket, over COMPLETED actor evaluations. Bucketed by when the judgment
   * landed (`evaluatedAt`, falling back to `createdAt` — `evaluatedAt` is
   * nullable in the entity even for COMPLETED rows). Buckets with no evaluated
   * sessions are absent (an average has no meaningful zero — not gap-filled).
   */
  async getQualityTrendByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<QualityTrendBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(d."evaluatedAt", d."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect(
        'round(avg(d."compositeScore")::numeric, 1)::float',
        'avgCompositeScore',
      )
      .addSelect('COUNT(*)::int', 'evaluatedSessions')
      .from('scenario_session_details', 'd')
      .where('d."evaluationStatus" = :status', {
        status: ActorEvaluationStatus.COMPLETED,
      })
      .andWhere('d."compositeScore" IS NOT NULL')
      .andWhere('COALESCE(d."evaluatedAt", d."createdAt") >= :start', { start })
      .andWhere('COALESCE(d."evaluatedAt", d."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('d."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('d."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        avgCompositeScore: number | null;
        evaluatedSessions: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      avgCompositeScore:
        r.avgCompositeScore === null ? null : Number(r.avgCompositeScore),
      evaluatedSessions: Number(r.evaluatedSessions) || 0,
    }));
  }

  /** Whole-window mean composite score + count (exact KPI, not re-averaged). */
  async getQualityOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<{ avgCompositeScore: number | null; evaluatedSessions: number }> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        'round(avg(d."compositeScore")::numeric, 1)::float',
        'avgCompositeScore',
      )
      .addSelect('COUNT(*)::int', 'evaluatedSessions')
      .from('scenario_session_details', 'd')
      .where('d."evaluationStatus" = :status', {
        status: ActorEvaluationStatus.COMPLETED,
      })
      .andWhere('d."compositeScore" IS NOT NULL')
      .andWhere('COALESCE(d."evaluatedAt", d."createdAt") >= :start', { start })
      .andWhere('COALESCE(d."evaluatedAt", d."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('d."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('d."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{
      avgCompositeScore: number | null;
      evaluatedSessions: number;
    }>();

    return {
      avgCompositeScore:
        row?.avgCompositeScore == null ? null : Number(row.avgCompositeScore),
      evaluatedSessions: Number(row?.evaluatedSessions) || 0,
    };
  }

  /**
   * Mean post-session learner rating + response count per bucket from
   * `scenario_session_feedbacks`. Buckets with no ratings are absent.
   */
  async getCsatTrendByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CsatTrendBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', f."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('round(avg(f."rating")::numeric, 2)::float', 'avgRating')
      .addSelect('COUNT(*)::int', 'responses')
      .from('scenario_session_feedbacks', 'f')
      .where('f."createdAt" >= :start', { start })
      .andWhere('f."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('f."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('f."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        avgRating: number | null;
        responses: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      avgRating: r.avgRating === null ? null : Number(r.avgRating),
      responses: Number(r.responses) || 0,
    }));
  }

  /** Whole-window mean learner rating + count (exact KPI, not re-averaged). */
  async getCsatOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<{ avgRating: number | null; responses: number }> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('round(avg(f."rating")::numeric, 2)::float', 'avgRating')
      .addSelect('COUNT(*)::int', 'responses')
      .from('scenario_session_feedbacks', 'f')
      .where('f."createdAt" >= :start', { start })
      .andWhere('f."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('f."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('f."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{
      avgRating: number | null;
      responses: number;
    }>();

    return {
      avgRating: row?.avgRating == null ? null : Number(row.avgRating),
      responses: Number(row?.responses) || 0,
    };
  }

  /**
   * Track-enrollment funnel for the cohort of enrollments CREATED in
   * [start, end): started/completed are counted for that cohort regardless of
   * when they happened, so enrolled >= started >= completed always holds.
   * NB: `track_enrollments` extends BaseWithoutTenantEntity with a camelCase
   * `tenantId` column (not the usual `tenant_id`) which is nullable, so the
   * tenant is reached through the enrolled user instead — the same route the
   * test-org exclusion takes.
   */
  async getTrackFunnelCounts(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<TrackFunnelCounts> {
    const tenantPredicate = tenantId
      ? `AND ${scopeToTenantByUser('e."userId"', '$3')}`
      : '';
    const rows = await this.dataSource.query(
      `
      SELECT
        COUNT(*)::int AS enrolled,
        COUNT(*) FILTER (WHERE e."startedAt" IS NOT NULL)::int AS started,
        COUNT(*) FILTER (WHERE e."completedAt" IS NOT NULL)::int AS completed
      FROM track_enrollments e
      WHERE e."deletedAt" IS NULL
        AND e."createdAt" >= $1 AND e."createdAt" < $2
        AND ${excludeTestTenantsByUser('e."userId"')}
        ${tenantPredicate}
      `,
      tenantId ? [start, end, tenantId] : [start, end],
    );
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      enrolled: Number(r.enrolled) || 0,
      started: Number(r.started) || 0,
      completed: Number(r.completed) || 0,
    };
  }

  /**
   * Attempt-level quiz pass counts over GRADED attempts in [start, end),
   * windowed on when the attempt was submitted. `track_quiz_attempts` has no
   * tenant column, so the tenant is reached through the attempting user.
   */
  async getQuizPassCounts(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<QuizPassCounts> {
    const tenantPredicate = tenantId
      ? `AND ${scopeToTenantByUser('q."userId"', '$4')}`
      : '';
    const rows = await this.dataSource.query(
      `
      SELECT
        COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE q."passed" = true)::int AS passed
      FROM track_quiz_attempts q
      WHERE q."deletedAt" IS NULL
        AND q."status" = $3
        AND COALESCE(q."submittedAt", q."createdAt") >= $1
        AND COALESCE(q."submittedAt", q."createdAt") < $2
        AND ${excludeTestTenantsByUser('q."userId"')}
        ${tenantPredicate}
      `,
      tenantId
        ? [start, end, QuizAttemptStatus.GRADED, tenantId]
        : [start, end, QuizAttemptStatus.GRADED],
    );
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      attempts: Number(r.attempts) || 0,
      passed: Number(r.passed) || 0,
    };
  }

  /**
   * Completed simulations per bucket (the cost-per-sim denominator).
   * Generalizes getSimulationsCompletedByWeek from week to any bucket.
   */
  async getCompletedSimulationsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CompletedSimsBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
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
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * AI usage per bucket x (service, provider, model) — the cost-per-sim
   * numerator's raw quantities. Mirrors LlmUsageRepository's grouping minus
   * `task` (pricing is keyed on service/provider/model only; task would just
   * multiply row count). USD cost is computed in the service from the pricing
   * tables — never in SQL. bigint sums come back as strings, hence Number().
   */
  async getAiUsageByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<AiUsageBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', lu."occurredAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('lu.service', 'service')
      .addSelect('lu.provider', 'provider')
      .addSelect('lu.model', 'model')
      .addSelect('COALESCE(SUM(lu."promptTokens"), 0)::bigint', 'promptTokens')
      .addSelect(
        'COALESCE(SUM(lu."completionTokens"), 0)::bigint',
        'completionTokens',
      )
      .addSelect('COALESCE(SUM(lu."audioMs"), 0)::bigint', 'audioMs')
      .addSelect('COALESCE(SUM(lu."characters"), 0)::bigint', 'characters')
      .addSelect('COUNT(*)::int', 'calls')
      .from('llm_usage', 'lu')
      .where('lu."occurredAt" >= :start', { start })
      .andWhere('lu."occurredAt" < :end', { end })
      // Null-preserving: most llm_usage rows are deliberately tenantless
      // (judges, autofill, translation) and must survive the filter.
      .andWhere(excludeTestTenants('lu."tenant_id"'))
      .groupBy('bucket')
      .addGroupBy('lu.service')
      .addGroupBy('lu.provider')
      .addGroupBy('lu.model')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        service: string;
        provider: string;
        model: string;
        promptTokens: string;
        completionTokens: string;
        audioMs: string;
        characters: string;
        calls: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      service: r.service,
      provider: r.provider,
      model: r.model,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      audioMs: Number(r.audioMs) || 0,
      characters: Number(r.characters) || 0,
      calls: Number(r.calls) || 0,
    }));
  }
}
