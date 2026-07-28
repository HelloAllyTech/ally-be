import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
import { QuizAttemptStatus } from '../../track/type/quiz.type';
import { AnalyticsBucket } from './platform-analytics.repository';

export interface TopOrgRow {
  tenantId: string;
  tenantName: string;
  completedSimulations: number;
}

export interface PracticeMinutesBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  minutes: number;
  activeLearners: number;
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
 */
@Injectable()
export class HighlightsAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): 'day' | 'week' | 'month' {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    return 'week';
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
   */
  async getTopOrgsByCompletedSims(
    start: Date,
    end: Date,
    limit = 10,
  ): Promise<TopOrgRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH agg AS (
        SELECT s."tenant_id" AS tenant_id, COUNT(*)::int AS completed
        FROM scenario_sessions s
        WHERE s."eventStatus" = $3
          AND COALESCE(s."endedAt", s."createdAt") >= $1
          AND COALESCE(s."endedAt", s."createdAt") < $2
        GROUP BY s."tenant_id"
        ORDER BY completed DESC
        LIMIT $4
      )
      SELECT
        agg.tenant_id                   AS "tenantId",
        COALESCE(t.name, agg.tenant_id) AS "tenantName",
        agg.completed                   AS "completedSimulations"
      FROM agg
      LEFT JOIN tenants t
        ON (t.id::text = agg.tenant_id OR t.code = agg.tenant_id)
       AND t."deletedAt" IS NULL
      ORDER BY agg.completed DESC
      `,
      [start, end, ScenarioSessionEventStatus.COMPLETED, limit],
    );
    return rows.map((r: Record<string, unknown>) => ({
      tenantId: r.tenantId as string,
      tenantName: r.tenantName as string,
      completedSimulations: Number(r.completedSimulations) || 0,
    }));
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
  ): Promise<PracticeMinutesBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
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
  ): Promise<QualityTrendBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
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
  ): Promise<{ avgCompositeScore: number | null; evaluatedSessions: number }> {
    const row = await this.dataSource
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
      .getRawOne<{
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
  ): Promise<CsatTrendBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
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
  ): Promise<{ avgRating: number | null; responses: number }> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('round(avg(f."rating")::numeric, 2)::float', 'avgRating')
      .addSelect('COUNT(*)::int', 'responses')
      .from('scenario_session_feedbacks', 'f')
      .where('f."createdAt" >= :start', { start })
      .andWhere('f."createdAt" < :end', { end })
      .getRawOne<{ avgRating: number | null; responses: number }>();

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
   * `tenantId` column (not the usual `tenant_id`) — unused here (platform-wide).
   */
  async getTrackFunnelCounts(
    start: Date,
    end: Date,
  ): Promise<TrackFunnelCounts> {
    const rows = await this.dataSource.query(
      `
      SELECT
        COUNT(*)::int AS enrolled,
        COUNT(*) FILTER (WHERE e."startedAt" IS NOT NULL)::int AS started,
        COUNT(*) FILTER (WHERE e."completedAt" IS NOT NULL)::int AS completed
      FROM track_enrollments e
      WHERE e."deletedAt" IS NULL
        AND e."createdAt" >= $1 AND e."createdAt" < $2
      `,
      [start, end],
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
   * tenant column at all — platform-wide only.
   */
  async getQuizPassCounts(start: Date, end: Date): Promise<QuizPassCounts> {
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
      `,
      [start, end, QuizAttemptStatus.GRADED],
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
  ): Promise<CompletedSimsBucketRow[]> {
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
