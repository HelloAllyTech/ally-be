import { Injectable } from '@nestjs/common';

import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  LowRatingTagDto,
  QualityBucketPointDto,
  QualityDistributionQueryDto,
  QualityDistributionResponseDto,
  SatisfactionBucketPointDto,
} from '../dto/quality-distribution-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  MIN_SCORE_SAMPLE_SIZE,
  QualityDistributionAnalyticsRepository,
} from '../repository/quality-distribution-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

/** Score axis. Fixed so a nine-point wobble cannot fill the chart. */
const SCORE_DOMAIN: [number, number] = [0, 100];

/** The rating scale the three satisfaction bands split up. */
const RATING_DOMAIN: [number, number] = [1, 5];

/**
 * Tag rows the pareto shows before pooling.
 *
 * Eight because a pareto is read by comparing the head against the rest, and past
 * eight bars the eye stops ranking and starts scanning. The tail is not dropped —
 * it becomes one "Other" row, so the parts still sum to
 * `summary.taggedLowRatings` and a reader can see how long the tail is.
 */
const TOP_TAG_ROWS = 8;

/** Label for the pooled tail of the tag pareto. */
const OTHER_TAG_LABEL = 'Other';

/**
 * Bucket granularity per range.
 *
 * Coarser than the highlights mapping (which puts 30d on a daily axis) and
 * deliberately so: both series here need a sample per bucket — a percentile wants
 * {@link MIN_SCORE_SAMPLE_SIZE} evaluated sessions, a top-2-box share wants
 * enough responses that one grumpy learner does not move it. A daily axis over 30
 * days would suppress nearly every cell and the card would read as "no data"
 * when the truth is "not at that grain". The reader can still ask for `day`.
 *
 * `all` never reaches this function — the window util resolves an all-time range
 * to month, which is where that default belongs (it is a property of the range,
 * not of this endpoint).
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' ? 'month' : 'week';

const round1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class QualityDistributionAnalyticsService {
  constructor(private readonly repo: QualityDistributionAnalyticsRepository) {}

  /**
   * Roleplay quality as a distribution, and learner satisfaction as counts of
   * people.
   *
   * Four rules live here rather than in the repository or the client, because
   * each of them is a place where two surfaces could otherwise disagree:
   *
   *  - **The sample floor is applied server-side.** A thin bucket comes back with
   *    its percentiles nulled and its count intact. Suppressing in the client
   *    means every client re-implements the floor, and one of them eventually
   *    draws the line anyway.
   *  - **Quality stays sparse; satisfaction is gap-filled.** The difference is
   *    not stylistic: a count has a real zero ("nobody rated a session that
   *    month") and a percentile does not (the median of no sessions is not 0/100).
   *    Gap-filling the score series would fabricate a measurement.
   *  - **Every share is null over a zero denominator.** 0/0 is not 0% — a bucket
   *    with no responses has no top-2-box share, and a period with no completed
   *    sessions has no response rate. Rendering those as zero invents a bad month.
   *  - **The tag tail is pooled, not dropped.** Keeping the top rows and
   *    discarding the rest would make the visible bars sum to less than the
   *    denominator beside them, which reads as a bug in the numbers.
   */
  async getQualityDistribution(
    query: QualityDistributionQueryDto,
  ): Promise<QualityDistributionResponseDto> {
    // The data floor is one extra cheap query, and only for an all-time range —
    // which IS the default here, so it is normally paid.
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const tenantId = query.tenantId?.trim() || undefined;
    const { start, endExclusive, bucket } = window;

    const [
      qualityRows,
      qualityOverall,
      satisfactionRows,
      satisfactionOverall,
      completedRows,
      completedOverall,
      tagResult,
    ] = await Promise.all([
      withReportingQuerySlot(() =>
        this.repo.getQualityByBucket(start, endExclusive, bucket, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getQualityOverall(start, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getSatisfactionByBucket(
          start,
          endExclusive,
          bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getSatisfactionOverall(start, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCompletedSessionsByBucket(
          start,
          endExclusive,
          bucket,
          tenantId,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCompletedSessionsOverall(start, endExclusive, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getLowRatingTags(start, endExclusive, tenantId),
      ),
    ]);

    // Quality: straight through, floor applied, buckets with no evaluations
    // absent. The axis is deliberately left with holes in it — see the class doc.
    const quality: QualityBucketPointDto[] = qualityRows.map((r) => {
      const thin = r.evaluatedSessions < MIN_SCORE_SAMPLE_SIZE;
      return {
        bucket: r.bucket,
        median: thin ? null : r.median,
        p25: thin ? null : r.p25,
        p75: thin ? null : r.p75,
        evaluatedSessions: r.evaluatedSessions,
      };
    });

    // Satisfaction: counts on a contiguous axis, shares null over zero.
    const labels = generateBucketLabels(start, endExclusive, bucket);
    const responsesByBucket = new Map(
      satisfactionRows.map((r) => [r.bucket, r]),
    );
    const completedByBucket = new Map(
      completedRows.map((r) => [r.bucket, r.completedSessions]),
    );
    const satisfaction: SatisfactionBucketPointDto[] = labels.map(
      (bucketKey) => {
        const counts = responsesByBucket.get(bucketKey);
        const low = counts?.low ?? 0;
        const mid = counts?.mid ?? 0;
        const high = counts?.high ?? 0;
        const responses = counts?.responses ?? 0;
        const completedSessions = completedByBucket.get(bucketKey) ?? 0;
        return {
          bucket: bucketKey,
          low,
          mid,
          high,
          responses,
          top2BoxPct: this.pct(high, responses),
          completedSessions,
          responseRatePct: this.pct(responses, completedSessions),
        };
      },
    );

    const overallThin =
      qualityOverall.evaluatedSessions < MIN_SCORE_SAMPLE_SIZE;

    return {
      window: describeWindow(window),
      quality,
      satisfaction,
      lowRatingTags: this.poolTagTail(tagResult.tags),
      summary: {
        evaluatedSessions: qualityOverall.evaluatedSessions,
        medianScore: overallThin ? null : qualityOverall.median,
        p25: overallThin ? null : qualityOverall.p25,
        p75: overallThin ? null : qualityOverall.p75,
        responses: satisfactionOverall.responses,
        low: satisfactionOverall.low,
        mid: satisfactionOverall.mid,
        high: satisfactionOverall.high,
        top2BoxPct: this.pct(
          satisfactionOverall.high,
          satisfactionOverall.responses,
        ),
        completedSessions: completedOverall,
        responseRatePct: this.pct(
          satisfactionOverall.responses,
          completedOverall,
        ),
        taggedLowRatings: tagResult.taggedResponses,
      },
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: SCORE_DOMAIN,
      ratingDomain: RATING_DOMAIN,
      // Evaluations, feedback and sessions all carry a tenant, so unlike AI cost
      // there is nothing here that has to stay platform-wide under a filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * A percentage, or null when there is nothing to divide by.
   *
   * Null rather than 0: "0% of learners were satisfied" and "nobody was asked"
   * are different facts, and only one of them is bad news.
   */
  private pct(numerator: number, denominator: number): number | null {
    if (!denominator) return null;
    return round1((numerator / denominator) * 100);
  }

  /**
   * Keep the head of the pareto, pool the tail into one "Other" row.
   *
   * Pooled rather than truncated so the bars still sum to
   * `summary.taggedLowRatings`; a chart whose parts do not add up to the total
   * printed beside it gets read as a bug in the data rather than as a design
   * choice. "Other" is emitted only when the tail is non-empty — an empty
   * category is a bar that means nothing.
   */
  private poolTagTail(
    tags: { tag: string; count: number }[],
  ): LowRatingTagDto[] {
    const head = tags.slice(0, TOP_TAG_ROWS).map((t) => ({ ...t }));
    const tail = tags.slice(TOP_TAG_ROWS);
    if (!tail.length) return head;
    return [
      ...head,
      {
        tag: OTHER_TAG_LABEL,
        count: tail.reduce((sum, t) => sum + t.count, 0),
      },
    ];
  }
}
