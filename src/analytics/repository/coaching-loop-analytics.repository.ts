import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';
import { AnalyticsBucket } from './platform-analytics.repository';

/**
 * Smallest number of commented-on reviews a TURNAROUND may be stated for.
 *
 * Imported from {@link MIN_COHORT_SIZE} rather than redeclared — one floor across
 * the whole analytics surface. It carries a second justification here on top of
 * the privacy one: a median over two reviews is noise, and a noisy median is worse
 * than no median because it reads as a measurement and gets acted on.
 */
export const MIN_COACHING_SAMPLE_SIZE = MIN_COHORT_SIZE;

/**
 * Reviews created in one bucket (or, for the whole-window row, in the window),
 * with how many of them got an answer and how long it took.
 */
export interface CoachingLoopReviewRow {
  /** Bucket start `yyyy-mm-dd`; the empty string for the whole-window row. */
  bucket: string;
  /** Reviews created — one per session shared for review. */
  sharedSessions: number;
  /** Of those, reviews with >= 1 non-deleted comment from someone else. */
  reviewsWithComment: number;
  /** Non-deleted comments from someone other than the review's creator. */
  comments: number;
  /**
   * Median hours from review creation to its first comment from someone else.
   * NULL when nothing was commented on. The SAMPLE FLOOR is not applied here —
   * the repository reports what it measured and the service decides what may be
   * shown, so the floor lives in exactly one place and is testable without a
   * database.
   */
  medianHoursToFirstComment: number | null;
  /** The same measurement at the 90th percentile; NULL on no observations. */
  p90HoursToFirstComment: number | null;
}

/** Completed simulations in one bucket — the share denominator. */
export interface CoachingLoopCompletedRow {
  bucket: string;
  completedSessions: number;
}

/**
 * The human feedback loop on shared roleplay sessions — "is anyone answering, and
 * how fast?" — for the leadership Highlights tab.
 *
 * The question: a learner can share a completed simulation for review; a trainer
 * or peer can comment on it. Both halves are optional, and a programme where
 * nobody shares and a programme where everybody shares but nobody replies fail in
 * completely different ways. So this endpoint measures three things per bucket:
 * how many sessions were shared, what share of completions that is, and — of the
 * shares — how many got an answer and how long the learner waited for it.
 *
 * `medianHoursToFirstComment` is paired with p90 on purpose. Turnaround is
 * heavily skewed: a median of six hours next to a p90 of ten days is a programme
 * where most learners are answered promptly and a minority are effectively
 * ignored, and the median alone would report that as a success.
 *
 * AGGREGATE ONLY. There is no per-trainer or per-reviewer method here and there
 * must not be one: turnaround per named individual is a league table, and "who
 * was slow to respond to a session about a distressing call" is a
 * clinical-adjacent judgement a leadership dashboard is not equipped to make.
 *
 * Definitional notes, because they are the parts a reader will otherwise assume:
 *  - A comment counts only if its author is NOT the review's creator. A learner
 *    replying to their own share is not the loop closing.
 *  - Deleted comments and deleted threads are excluded; HIDDEN comments are
 *    kept. `hidden` is moderation of content, not a retraction of the fact that a
 *    human responded, and this metric is about the response happening.
 *  - Reviews and completions are timestamped independently (review `createdAt`
 *    vs. the session's `COALESCE(endedAt, createdAt)`), so a review in one bucket
 *    may belong to a session in an earlier one. The share is therefore a
 *    rate-of-sharing indicator, not a per-session cohort rate; the DTO says so.
 *  - Both halves apply {@link countableSessionPredicate}, so preview and seed
 *    rooms are out of the numerator AND the denominator. That makes the completed
 *    count here sit slightly below the Overview tab's, which predates the shared
 *    predicate — this surface's two figures agree with each other, which is what
 *    a ratio needs.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables BY
 * NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), truncated dates out as `yyyy-mm-dd` strings, counts `::int` and
 * re-parsed defensively in JS.
 */
@Injectable()
export class CoachingLoopAnalyticsRepository {
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
   * Where the platform's data begins — the left edge of `range=all`. The same
   * measurement every other all-time chart uses, so this axis and theirs cover the
   * same period rather than two that nearly line up.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** Per-bucket review activity. */
  async getReviewsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CoachingLoopReviewRow[]> {
    return this.queryReviews(start, end, this.resolveBucket(bucket), tenantId);
  }

  /**
   * The same figures over the whole window, in one row.
   *
   * Re-queried rather than folded up from the buckets because the percentiles
   * cannot be: a median of per-bucket medians weights a month with two reviews the
   * same as a month with two hundred. (The counts would fold up exactly, but
   * splitting the summary across two sources is how the count and the percentile
   * end up describing different sets of reviews.)
   */
  async getReviewTotals(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<CoachingLoopReviewRow> {
    const rows = await this.queryReviews(start, end, null, tenantId);
    return (
      rows[0] ?? {
        bucket: '',
        sharedSessions: 0,
        reviewsWithComment: 0,
        comments: 0,
        medianHoursToFirstComment: null,
        p90HoursToFirstComment: null,
      }
    );
  }

  /**
   * One SQL for both the trend and the total: `trunc` null collapses the axis to a
   * single row keyed on the empty string. Two near-identical queries would be two
   * places for the definition of "a shared session" to drift.
   */
  private async queryReviews(
    start: Date,
    end: Date,
    trunc: AnalyticsBucket | null,
    tenantId?: string,
  ): Promise<CoachingLoopReviewRow[]> {
    const params: unknown[] = [start, end];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant(
        'r."tenant_id"',
        `$${params.length}`,
      )}`;
    }

    const bucketExpr = trunc
      ? `to_char(date_trunc('${trunc}', r."createdAt"), 'YYYY-MM-DD')`
      : `''::text`;

    // Hours waited, clamped at zero: a comment cannot precede the review it is
    // on, so a negative interval is clock skew between writers and must not be
    // allowed to drag a median below zero.
    const hours = `GREATEST(EXTRACT(EPOCH FROM (fc.first_at - rv."createdAt")) / 3600.0, 0)`;

    const rows = await this.dataSource.query(
      `
      WITH reviews AS (
        SELECT
          r.id,
          r."createdAt",
          r."createdBy",
          ${bucketExpr} AS bucket
        FROM scenario_session_reviews r
        JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        WHERE r."createdAt" >= $1
          AND r."createdAt" < $2
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('r."tenant_id"')}
          ${tenantPredicate}
      ),
      first_comment AS (
        SELECT
          rv.id                  AS review_id,
          MIN(c."createdAt")     AS first_at,
          COUNT(*)::int          AS comments
        FROM reviews rv
        JOIN scenario_session_review_threads th
             ON th."reviewId" = rv.id AND th."deletedAt" IS NULL
        JOIN scenario_session_review_comments c
             ON c."reviewThreadId" = th.id AND c."deletedAt" IS NULL
        WHERE c."createdBy" <> rv."createdBy"
        GROUP BY rv.id
      )
      SELECT
        rv.bucket                                              AS "bucket",
        COUNT(*)::int                                          AS "sharedSessions",
        COUNT(fc.review_id)::int                               AS "reviewsWithComment",
        COALESCE(SUM(fc.comments), 0)::int                     AS "comments",
        round(
          (percentile_cont(0.5) WITHIN GROUP (ORDER BY ${hours})
            FILTER (WHERE fc.first_at IS NOT NULL))::numeric, 1
        )::float                                               AS "medianHours",
        round(
          (percentile_cont(0.9) WITHIN GROUP (ORDER BY ${hours})
            FILTER (WHERE fc.first_at IS NOT NULL))::numeric, 1
        )::float                                               AS "p90Hours"
      FROM reviews rv
      LEFT JOIN first_comment fc ON fc.review_id = rv.id
      GROUP BY rv.bucket
      ORDER BY rv.bucket ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: String(r.bucket ?? ''),
      sharedSessions: Number(r.sharedSessions) || 0,
      reviewsWithComment: Number(r.reviewsWithComment) || 0,
      comments: Number(r.comments) || 0,
      // NULL when nothing in the group was commented on — not zero. "Answered in
      // 0 hours" and "never answered" are opposite facts.
      medianHoursToFirstComment: nullableNumber(r.medianHours),
      p90HoursToFirstComment: nullableNumber(r.p90Hours),
    }));
  }

  /**
   * Completed simulations per bucket — the denominator for `sharePct`.
   *
   * Timestamped by `COALESCE(endedAt, createdAt)` like every other completion
   * count on these surfaces, and filtered by {@link countableSessionPredicate} so
   * a preview room cannot inflate the denominator and make sharing look rarer than
   * it is.
   */
  async getCompletedSessionsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CoachingLoopCompletedRow[]> {
    const trunc = this.resolveBucket(bucket);
    const params: unknown[] = [
      start,
      end,
      ScenarioSessionEventStatus.COMPLETED,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant(
        's."tenant_id"',
        `$${params.length}`,
      )}`;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(date_trunc('${trunc}', COALESCE(s."endedAt", s."createdAt")),
                'YYYY-MM-DD')                    AS "bucket",
        COUNT(*)::int                            AS "completedSessions"
      FROM scenario_sessions s
      WHERE s."eventStatus" = $3
        AND COALESCE(s."endedAt", s."createdAt") >= $1
        AND COALESCE(s."endedAt", s."createdAt") < $2
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: String(r.bucket),
      completedSessions: Number(r.completedSessions) || 0,
    }));
  }
}

/** Null-preserving numeric parse: a missing percentile stays missing. */
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}
