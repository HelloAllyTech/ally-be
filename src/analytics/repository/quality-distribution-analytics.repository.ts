import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { ActorEvaluationStatus } from '../../learn/service/scenario-session-evaluation.service';
import { AnalyticsBucket } from './platform-analytics.repository';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Smallest number of observations a DERIVED SCORE may be stated from.
 *
 * The composite score is an LLM judge's opinion aggregated over a rubric, so its
 * per-session variance is large: below roughly twenty observations the median of
 * a bucket moves several points when a single session lands in it, which is
 * noise wearing a decimal point (wiki `product/data-visualisation.md`,
 * principle 4 — never state a derived score from a sample that cannot support
 * it). Below the floor the COUNT still travels and the score does not, so the
 * surface can say "n = 4 · need 20" instead of drawing a line through a rumour.
 *
 * The admin frontend holds the same number as `MIN_N_FOR_SCORE` in
 * `apps/ally-admin-dashboard/src/pages/Analytics/chartKit.tsx` (it decides
 * whether to badge a cell as a thin sample). THE TWO MUST CHANGE TOGETHER — a
 * server that suppresses at 20 and a client that badges at 30 produces cells
 * that are blank with no explanation.
 *
 * Distinct from MIN_COHORT_SIZE / MIN_ORG_GROUP_SIZE (5), which are PRIVACY
 * floors on naming a small group of people. This one is a STATISTICAL floor on
 * believing a number, and it is deliberately higher; the two answer different
 * questions and must not be collapsed into one constant.
 */
export const MIN_SCORE_SAMPLE_SIZE = 20;

/**
 * How the 1-5 post-session rating is collapsed for the stacked satisfaction bar.
 *
 * Three bands rather than five: the decision a reader makes from this chart is
 * "is the bad slice growing", and five near-identical segments make that harder
 * to see than three. The split is the standard top-2-box / bottom-2-box reading,
 * with 3 kept as its own band rather than folded into either — a neutral rating
 * is not a complaint, and counting it as one inflates the problem while counting
 * it as a success hides one.
 */
export const SATISFACTION_LOW_MAX_RATING = 2;
export const SATISFACTION_HIGH_MIN_RATING = 4;

/**
 * Ratings at or below this are the ones whose tags are worth a pareto.
 *
 * Includes the neutral 3: a learner who rates a session 3 and tags it
 * "unrealistic persona" is reporting the same defect as one who rated it 2, and
 * dropping them halves the sample the tag chart is built from for no gain.
 */
export const LOW_RATING_TAG_MAX_RATING = 3;

/** One quality bucket. Percentiles are RAW here — the service applies the floor. */
export interface QualityBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  evaluatedSessions: number;
}

/** Whole-window quality percentiles — the exact KPI, not re-averaged buckets. */
export interface QualityOverallRow {
  median: number | null;
  p25: number | null;
  p75: number | null;
  evaluatedSessions: number;
}

/** One satisfaction bucket: the three rating bands and the response total. */
export interface SatisfactionBucketRow {
  bucket: string;
  low: number;
  mid: number;
  high: number;
  responses: number;
}

/** Whole-window rating band counts. */
export interface SatisfactionOverallRow {
  low: number;
  mid: number;
  high: number;
  responses: number;
}

/** Completed sessions per bucket — the response-rate denominator. */
export interface CompletedSessionsBucketRow {
  bucket: string;
  completedSessions: number;
}

/** One tag on a low/neutral-rated session. */
export interface LowRatingTagRow {
  tag: string;
  count: number;
}

/**
 * Tag counts plus the denominator they are a breakdown OF.
 *
 * A tag pareto without its own denominator is unreadable: "unrealistic persona
 * · 42" could be 42 of 50 complaints or 42 of 4,000. `taggedResponses` is the
 * number of low/neutral ratings that carried at least one tag, which is the only
 * denominator the tag counts are shares of — not all low ratings (most carry no
 * tag at all) and certainly not all responses.
 */
export interface LowRatingTagResult {
  tags: LowRatingTagRow[];
  taggedResponses: number;
}

/**
 * Distribution-aware quality + satisfaction for the leadership Highlights tab —
 * the successor to `HighlightsAnalyticsRepository.getQualityTrendByBucket` and
 * `getCsatTrendByBucket`, which are left in place and untouched.
 *
 * Two things those two cannot say, and this one exists to say:
 *
 *  - **A mean hides the shape.** A composite score of 68 can be everybody
 *    scoring 68, or half the platform at 40 and half at 95 — and only the second
 *    is a training problem with somewhere to aim. So quality travels as a median
 *    with a p25-p75 band: the median says where the typical session sits, the
 *    band says how much of a claim the median is (wiki
 *    `product/data-visualisation.md` — show the distribution when the decision
 *    depends on the spread, not just the centre).
 *  - **A mean rating of 4.1 is not a satisfaction reading.** Ratings are
 *    ordinal, so their arithmetic mean is a number with no unit: 4.1 could be
 *    everyone content or a bimodal split of delight and disgust. The bands
 *    (1-2 / 3 / 4-5) are counts of people, which is what a top-2-box reading is
 *    built from, and they carry the response-rate denominator so a rise in
 *    "high" that is really a fall in responses cannot pass for good news.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL / query
 * builder over tables BY NAME (no entity repos), quoted camelCase identifiers
 * (only `tenant_id` is snake_case), truncated dates out as `yyyy-mm-dd`, counts
 * `::int` and re-parsed defensively in JS.
 *
 * Every query excludes test orgs and honours an optional single-tenant narrowing;
 * every query that touches `scenario_sessions` also applies
 * {@link countableSessionPredicate} so preview and seed rooms cannot inflate the
 * response-rate denominator.
 *
 * Percentiles come back RAW. Suppressing a thin cell is the service's job — the
 * repository would otherwise have to return the count and the reason separately,
 * and a client reading a null with no `n` beside it has no way to tell "nobody
 * practised" from "not enough to say".
 */
@Injectable()
export class QualityDistributionAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal and whitelisted by the DTO, but
    // nothing that reaches an interpolated position goes unchecked.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of `range=all`. The same
   * measurement every other all-time-capable endpoint uses, so this card's axis
   * starts where theirs do rather than a day or two off.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Median / p25 / p75 composite score + evaluated-session count per bucket.
   *
   * Bucketed on `COALESCE(d."evaluatedAt", d."createdAt")` — deliberately the
   * same expression as the existing quality trend (`evaluatedAt` is nullable in
   * the entity even for COMPLETED rows), so the two cards on the tab put the same
   * session in the same bucket. Judging lags the session by minutes, so this is
   * "when the verdict landed", not "when the practice happened"; at week and
   * month grain the difference is invisible and at day grain it shifts a handful
   * of late-night sessions one bucket right.
   *
   * Buckets with no evaluated sessions are ABSENT, and the service must not
   * gap-fill them: a percentile of no observations is not zero, and a zero
   * plotted on a 0-100 score axis reads as "the platform collapsed that week".
   */
  async getQualityByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<QualityBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(d."evaluatedAt", d."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect(this.percentileExpr(0.5), 'median')
      .addSelect(this.percentileExpr(0.25), 'p25')
      .addSelect(this.percentileExpr(0.75), 'p75')
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
        median: number | null;
        p25: number | null;
        p75: number | null;
        evaluatedSessions: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      median: this.num(r.median),
      p25: this.num(r.p25),
      p75: this.num(r.p75),
      evaluatedSessions: Number(r.evaluatedSessions) || 0,
    }));
  }

  /**
   * Whole-window percentiles + count.
   *
   * Computed over the raw sessions rather than re-derived from the buckets: a
   * median of per-bucket medians is not a median of anything, and it weights a
   * quiet week the same as a busy one.
   */
  async getQualityOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<QualityOverallRow> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select(this.percentileExpr(0.5), 'median')
      .addSelect(this.percentileExpr(0.25), 'p25')
      .addSelect(this.percentileExpr(0.75), 'p75')
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
      median: number | null;
      p25: number | null;
      p75: number | null;
      evaluatedSessions: number;
    }>();

    return {
      median: this.num(row?.median),
      p25: this.num(row?.p25),
      p75: this.num(row?.p75),
      evaluatedSessions: Number(row?.evaluatedSessions) || 0,
    };
  }

  /**
   * Rating band counts per bucket, from `scenario_session_feedbacks`.
   *
   * Bucketed on the feedback row's own `createdAt` (the same expression the
   * existing CSAT trend uses) — the moment the learner answered, which is the
   * event being counted.
   *
   * Counts only. Every share, top-2-box included, is derived in the service so
   * that one denominator is chosen once; a client dividing "high" by whatever
   * total is nearest to hand is how a satisfaction figure ends up being a share
   * of a different population per chart.
   */
  async getSatisfactionByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<SatisfactionBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', f."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*) FILTER (WHERE f."rating" <= :lowMax)::int', 'low')
      .addSelect(
        'COUNT(*) FILTER (WHERE f."rating" > :lowMax AND f."rating" < :highMin)::int',
        'mid',
      )
      .addSelect('COUNT(*) FILTER (WHERE f."rating" >= :highMin)::int', 'high')
      .addSelect('COUNT(*)::int', 'responses')
      .from('scenario_session_feedbacks', 'f')
      .where('f."createdAt" >= :start', { start })
      .andWhere('f."createdAt" < :end', { end })
      .andWhere('f."rating" IS NOT NULL')
      .andWhere(excludeTestTenants('f."tenant_id"'))
      .setParameters({
        lowMax: SATISFACTION_LOW_MAX_RATING,
        highMin: SATISFACTION_HIGH_MIN_RATING,
      });
    if (tenantId) {
      qb.andWhere(scopeToTenant('f."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{
        bucket: string;
        low: number;
        mid: number;
        high: number;
        responses: number;
      }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      low: Number(r.low) || 0,
      mid: Number(r.mid) || 0,
      high: Number(r.high) || 0,
      responses: Number(r.responses) || 0,
    }));
  }

  /** Whole-window rating band counts (exact KPI, not re-summed from buckets). */
  async getSatisfactionOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<SatisfactionOverallRow> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(*) FILTER (WHERE f."rating" <= :lowMax)::int', 'low')
      .addSelect(
        'COUNT(*) FILTER (WHERE f."rating" > :lowMax AND f."rating" < :highMin)::int',
        'mid',
      )
      .addSelect('COUNT(*) FILTER (WHERE f."rating" >= :highMin)::int', 'high')
      .addSelect('COUNT(*)::int', 'responses')
      .from('scenario_session_feedbacks', 'f')
      .where('f."createdAt" >= :start', { start })
      .andWhere('f."createdAt" < :end', { end })
      .andWhere('f."rating" IS NOT NULL')
      .andWhere(excludeTestTenants('f."tenant_id"'))
      .setParameters({
        lowMax: SATISFACTION_LOW_MAX_RATING,
        highMin: SATISFACTION_HIGH_MIN_RATING,
      });
    if (tenantId) {
      qb.andWhere(scopeToTenant('f."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{
      low: number;
      mid: number;
      high: number;
      responses: number;
    }>();

    return {
      low: Number(row?.low) || 0,
      mid: Number(row?.mid) || 0,
      high: Number(row?.high) || 0,
      responses: Number(row?.responses) || 0,
    };
  }

  /**
   * Completed sessions per bucket — the denominator the response rate is a share
   * of, and the reason it is here rather than left to the caller to borrow from
   * another endpoint.
   *
   * "Completed session" mirrors the Highlights/Overview definition
   * (`eventStatus = COMPLETED`, timestamped by `COALESCE(endedAt, createdAt)`)
   * so this figure reconciles with the volume charts, PLUS
   * {@link countableSessionPredicate}: a preview or seed room can never produce a
   * feedback row, so counting one in the denominator would report a falling
   * response rate every time somebody tested a scenario.
   *
   * The two timestamps are not the same clock — a session that ends at 23:58 and
   * is rated at 00:02 lands in two different DAY buckets — so at day grain a
   * bucket's response rate can exceed 100%. It is not clamped: clamping would
   * hide a boundary effect behind a number that looks exact, and the honest fix
   * is a coarser bucket, which the reader can choose.
   */
  async getCompletedSessionsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CompletedSessionsBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'completedSessions')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(countableSessionPredicate('s'))
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; completedSessions: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      completedSessions: Number(r.completedSessions) || 0,
    }));
  }

  /** Whole-window completed sessions — the summary's response-rate denominator. */
  async getCompletedSessionsOverall(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'completedSessions')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .andWhere(countableSessionPredicate('s'))
      .andWhere(excludeTestTenants('s."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{ completedSessions: number }>();
    return Number(row?.completedSessions) || 0;
  }

  /**
   * Tags on low and neutral ratings across the whole window, ordered by count.
   *
   * NOT bucketed, deliberately: a tag pareto answers "what is wrong", which is a
   * question about the current shape of the complaints, and slicing 40
   * complaints across 12 months leaves every bar too short to rank. The window
   * still applies — it is the period the reader chose.
   *
   * `tags` is a jsonb string array. Three defences, each for a real failure mode
   * rather than for tidiness:
   *   - `jsonb_typeof(...) = 'array'` — `jsonb_array_elements_text` ABORTS the
   *     whole query on a non-array value, so one malformed row would take the
   *     card down rather than being skipped.
   *   - `SELECT DISTINCT (id, tag)` — the same tag twice in one response's array
   *     is one complaint, not two.
   *   - blank tags dropped — an empty string would render as an unlabelled bar.
   *
   * Returns EVERY tag; the caller keeps the head and pools the tail into one
   * "Other" row. That split belongs to the caller because the number of bars a
   * surface can carry is a property of the surface, and because pooling in SQL
   * would mean the total could not be checked against the parts.
   */
  async getLowRatingTags(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<LowRatingTagResult> {
    const params: unknown[] = [start, end, LOW_RATING_TAG_MAX_RATING];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('f."tenant_id"', `$${params.length}`)}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH tagged AS (
        SELECT DISTINCT f.id AS feedback_id, btrim(t.tag) AS tag
        FROM scenario_session_feedbacks f
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(f."tags") = 'array'
               THEN f."tags" ELSE '[]'::jsonb END
        ) AS t(tag)
        WHERE f."rating" IS NOT NULL
          AND f."rating" <= $3
          AND f."createdAt" >= $1
          AND f."createdAt" < $2
          AND btrim(t.tag) <> ''
          AND ${excludeTestTenants('f."tenant_id"')}
          ${tenantPredicate}
      ),
      totals AS (
        SELECT COUNT(DISTINCT feedback_id)::int AS "taggedResponses" FROM tagged
      )
      SELECT
        tagged.tag                AS "tag",
        COUNT(*)::int             AS "count",
        totals."taggedResponses"  AS "taggedResponses"
      FROM tagged
      CROSS JOIN totals
      GROUP BY tagged.tag, totals."taggedResponses"
      ORDER BY "count" DESC, "tag" ASC
      `,
      params,
    );

    // `taggedResponses` is a window-level constant repeated on every row. No
    // rows means no tagged responses (a tagged response produces at least one
    // tag row by construction), so zero is the right answer and no second query
    // is needed to establish it.
    const first = (rows[0] ?? {}) as Record<string, unknown>;

    return {
      tags: (rows as Record<string, unknown>[]).map((r) => ({
        tag: r.tag as string,
        count: Number(r.count) || 0,
      })),
      taggedResponses: rows.length ? Number(first.taggedResponses) || 0 : 0,
    };
  }

  /**
   * `percentile_cont` over the composite score, rounded to one decimal.
   *
   * One decimal because the score is a 0-100 integer: a second decimal implies
   * a precision the judge does not have, and a bare integer would hide the
   * half-point that separates two adjacent buckets. `percentile_cont`
   * interpolates, so a bucket of two sessions scoring 60 and 70 has a median of
   * 65 — which is exactly the reason the sample floor exists.
   *
   * The fraction reaches an interpolated position, so it is whitelisted rather
   * than trusted for being ours — the same reason `resolveBucket` exists.
   */
  private percentileExpr(fraction: 0.25 | 0.5 | 0.75): string {
    return (
      `round((percentile_cont(${fraction}) WITHIN GROUP ` +
      `(ORDER BY d."compositeScore"))::numeric, 1)::float`
    );
  }

  /** pg hands numerics back as strings; NULL must survive as null, not 0. */
  private num(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
}
