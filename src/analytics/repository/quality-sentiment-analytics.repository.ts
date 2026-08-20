import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { AnalyticsBucket } from './platform-analytics.repository';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/**
 * The learner rating scale, and where a proxy NPS cuts it.
 *
 * ## There is no real NPS on the platform
 *
 * Net Promoter Score is a 0–10 "how likely are you to recommend" question, scored
 * as %promoters(9–10) − %detractors(0–6). Ally has never asked it. The only
 * learner sentiment signal is `scenario_session_feedbacks.rating`, a 1–5
 * post-session score.
 *
 * So the figure this repository produces is a PROXY, computed by cutting the 1–5
 * scale the way NPS cuts 0–10: top box promotes, the box below is passive, the
 * rest detract. It behaves like NPS — same −100..+100 range, same sensitivity to
 * the middle emptying out — and it is not NPS. Two consequences that every
 * surface reading this must honour, and that the DTO repeats:
 *
 *  - **Label it as a proxy, every time.** "NPS (proxy from 1–5 rating)". A number
 *    on an NPS-shaped axis with no qualifier will be quoted to a board or a
 *    customer as an NPS, and it is not comparable with anyone else's.
 *  - **Never benchmark it externally.** A 5-point scale has a different top-box
 *    rate than an 11-point one, so this is comparable with ITSELF over time and
 *    with nothing else.
 *
 * The cut is at 5 / 4 / ≤3 rather than 4–5 / 3 / ≤2 because top-box on a 5-point
 * scale is the closest analogue to 9–10 on an 11-point one: treating 4 as a
 * promoter would put most respondents in the numerator and produce a flattering
 * number that barely moves.
 */
export const PROMOTER_MIN_RATING = 5;
export const PASSIVE_RATING = 4;
export const DETRACTOR_MAX_RATING = 3;

/**
 * Smallest number of responses a proxy NPS may be stated for.
 *
 * The same minimum-group-size rule as the rest of the analytics surface. It does
 * double duty here: below a handful of responses a single rating swings the score
 * by tens of points, so suppressing it protects the reader from noise as well as
 * protecting the respondent from being identified.
 */
export const MIN_SENTIMENT_RESPONSES = MIN_COHORT_SIZE;

/** One bucket of the quality-vs-sentiment comparison. */
export interface QualitySentimentBucketRow {
  /** Bucket start, `yyyy-mm-dd`. */
  bucket: string;
  /** Mean judge composite (0-100), or null with nothing evaluated. */
  avgCompositeScore: number | null;
  /** Sessions backing the mean. */
  evaluatedSessions: number;
  /** Learner ratings received. */
  responses: number;
  /** Ratings at {@link PROMOTER_MIN_RATING}. */
  promoters: number;
  /** Ratings at {@link PASSIVE_RATING}. */
  passives: number;
  /** Ratings at or below {@link DETRACTOR_MAX_RATING}. */
  detractors: number;
  /** Mean raw 1-5 rating, or null with no responses. */
  avgRating: number | null;
}

/**
 * Does the judge agree with the learner? — the LLM-judge composite score and
 * learner sentiment on one time axis.
 *
 * The pairing is the point. Each number alone is easy to move in the wrong
 * direction: a simulator tuned to score well can be joyless to talk to, and one
 * learners love can be letting them pass without stretching them. Divergence
 * between the two lines is the signal — quality up while sentiment falls means the
 * scenarios got harder, both falling means something broke.
 *
 * ## One x-axis, one timestamp
 *
 * Both series are bucketed on the SESSION's `COALESCE(endedAt, createdAt)`, not
 * on when the evaluation finished or when the learner happened to submit their
 * rating. Evaluation is asynchronous and a rating can arrive days later, so
 * bucketing each by its own write time would slide the two series against each
 * other and manufacture divergence that is really just latency. It also matches
 * the quality and CSAT trends already on the tab, so all four reconcile.
 *
 * ## The two series are aggregated separately, then joined
 *
 * A session has one details row but may carry more than one feedback row, so a
 * single query joining both tables would fan out and count a session's composite
 * score once per rating it received. Each side is therefore aggregated to one row
 * per bucket first and the two are joined on the bucket — a `FULL OUTER JOIN`,
 * because a bucket can have evaluations with no ratings or ratings with no
 * evaluations, and dropping either would silently shorten one line.
 *
 * ## Conventions
 *
 * Raw SQL over tables BY NAME; the grain travels as a bound parameter; counts
 * `::int`, means rounded in SQL and re-parsed defensively. Preview and seed rooms
 * are excluded through the shared predicate; buckets with neither an evaluation
 * nor a rating are absent, and the service leaves them as gaps rather than zeros —
 * a mean has no meaningful zero.
 */
@Injectable()
export class QualitySentimentAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * Deliberately the same measurement every sibling endpoint uses, so charts
   * composed onto one tab cover the same period rather than two axes that
   * nearly line up. See {@link getPlatformDataFloor}.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<QualitySentimentBucketRow[]> {
    const params: unknown[] = [
      bucket,
      ScenarioSessionEventStatus.COMPLETED,
      start,
      end,
      PROMOTER_MIN_RATING,
      PASSIVE_RATING,
      DETRACTOR_MAX_RATING,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }

    // The session-scoping predicate is identical on both sides on purpose: if the
    // two series disagreed about which sessions count, the comparison the chart
    // exists to make would be between two different populations.
    const sessionScope = `
        s."eventStatus" = $2
        AND COALESCE(s."endedAt", s."createdAt") >= $3
        AND COALESCE(s."endedAt", s."createdAt") < $4
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}`;

    const rows = await this.dataSource.query(
      `
      WITH quality AS (
        SELECT
          date_trunc($1, COALESCE(s."endedAt", s."createdAt"))       AS bucket,
          round(avg(d."compositeScore")::numeric, 1)::float          AS avg_composite,
          COUNT(*)::int                                             AS evaluated
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE ${sessionScope}
          AND d."compositeScore" IS NOT NULL
        GROUP BY 1
      ),
      sentiment AS (
        SELECT
          date_trunc($1, COALESCE(s."endedAt", s."createdAt"))       AS bucket,
          COUNT(*)::int                                             AS responses,
          COUNT(*) FILTER (WHERE f."rating" >= $5)::int             AS promoters,
          COUNT(*) FILTER (WHERE f."rating" = $6)::int              AS passives,
          COUNT(*) FILTER (WHERE f."rating" <= $7)::int             AS detractors,
          round(avg(f."rating")::numeric, 2)::float                 AS avg_rating
        FROM scenario_sessions s
        JOIN scenario_session_feedbacks f ON f."scenarioSessionId" = s.id
        WHERE ${sessionScope}
          AND f."rating" IS NOT NULL
        GROUP BY 1
      )
      SELECT
        to_char(COALESCE(q.bucket, n.bucket), 'YYYY-MM-DD') AS "bucket",
        q.avg_composite                                     AS "avgCompositeScore",
        COALESCE(q.evaluated, 0)                            AS "evaluatedSessions",
        COALESCE(n.responses, 0)                            AS "responses",
        COALESCE(n.promoters, 0)                            AS "promoters",
        COALESCE(n.passives, 0)                             AS "passives",
        COALESCE(n.detractors, 0)                           AS "detractors",
        n.avg_rating                                        AS "avgRating"
      FROM quality q
      FULL OUTER JOIN sentiment n ON n.bucket = q.bucket
      ORDER BY 1 ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      avgCompositeScore:
        r.avgCompositeScore === null ? null : Number(r.avgCompositeScore),
      evaluatedSessions: Number(r.evaluatedSessions) || 0,
      responses: Number(r.responses) || 0,
      promoters: Number(r.promoters) || 0,
      passives: Number(r.passives) || 0,
      detractors: Number(r.detractors) || 0,
      avgRating: r.avgRating === null ? null : Number(r.avgRating),
    }));
  }
}
