import { Injectable } from '@nestjs/common';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  CoachingLoopPointDto,
  CoachingLoopQueryDto,
  CoachingLoopResponseDto,
} from '../dto/coaching-loop-analytics.dto';
import {
  CoachingLoopAnalyticsRepository,
  MIN_COACHING_SAMPLE_SIZE,
} from '../repository/coaching-loop-analytics.repository';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** Percentages carry one decimal; the underlying counts are small. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The coaching loop for the Highlights tab: how much gets shared for review, how
 * much of that gets answered, and how long learners wait.
 *
 * Thin by design — the repository answers the question in three passes. What lives
 * here are the rules that decide what may be SHOWN, all of them house rules rather
 * than conveniences:
 *
 *  - **Counts gap-fill; rates do not.** Every bucket in the window is present with
 *    real zeros, because "nobody shared a session in April" is a measurement and a
 *    missing April invites the reader to compare two points a quarter apart. The
 *    percentages and percentiles over those zeros stay NULL — the mean of no
 *    observations is not zero, and a 0% share drawn over a month with no
 *    completions reports a quiet month as a failure to share.
 *  - **The turnaround floor is applied once, here.** Below
 *    {@link MIN_COACHING_SAMPLE_SIZE} commented-on reviews the median and p90 are
 *    suppressed and the counts stay. A median over two reviews is noise, and noise
 *    on a leadership chart gets acted on exactly like signal.
 *  - **The floor travels with the data.** The client is told `minSampleSize`
 *    instead of hard-coding a second copy, so a caption can explain the gap rather
 *    than leaving a hole in the line.
 *  - **No per-trainer breakdown, ever.** See the DTO: turnaround per named
 *    reviewer is a league table of individuals, and this dashboard must not make
 *    that judgement.
 */
@Injectable()
export class CoachingLoopAnalyticsService {
  constructor(private readonly repository: CoachingLoopAnalyticsRepository) {}

  /**
   * Bucket granularity per range. `all` and `12m` land on months; a rare event
   * like a shared session needs a wide bucket to clear the sample floor at all.
   */
  private static defaultBucketFor(range: AnalyticsRange): AnalyticsBucket {
    if (range === '30d') return 'day';
    if (range === '90d') return 'week';
    return 'month';
  }

  async getCoachingLoop(
    query: CoachingLoopQueryDto,
  ): Promise<CoachingLoopResponseDto> {
    // The data floor is one extra cheap query, and only for an all-time range —
    // which is this endpoint's default, so it is the common path rather than the
    // exception.
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: 'all',
      defaultBucketFor: CoachingLoopAnalyticsService.defaultBucketFor,
      allTimeStart: needsFloor
        ? await this.repository.getDataFloor()
        : undefined,
    });
    const { start, endExclusive, bucket } = window;
    const tenantId = query.tenantId?.trim() || undefined;

    const [reviewRows, completedRows, totals] = await Promise.all([
      this.repository.getReviewsByBucket(start, endExclusive, bucket, tenantId),
      this.repository.getCompletedSessionsByBucket(
        start,
        endExclusive,
        bucket,
        tenantId,
      ),
      this.repository.getReviewTotals(start, endExclusive, tenantId),
    ]);

    const reviewsByBucket = new Map(reviewRows.map((r) => [r.bucket, r]));
    const completedByBucket = new Map(
      completedRows.map((r) => [r.bucket, r.completedSessions]),
    );

    const points: CoachingLoopPointDto[] = generateBucketLabels(
      start,
      endExclusive,
      bucket,
    ).map((key) => {
      const review = reviewsByBucket.get(key);
      const sharedSessions = review?.sharedSessions ?? 0;
      const completedSessions = completedByBucket.get(key) ?? 0;
      const reviewsWithComment = review?.reviewsWithComment ?? 0;
      const enoughSamples = reviewsWithComment >= MIN_COACHING_SAMPLE_SIZE;

      return {
        bucket: key,
        sharedSessions,
        completedSessions,
        sharePct:
          completedSessions > 0
            ? round1((sharedSessions / completedSessions) * 100)
            : null,
        reviewsWithComment,
        medianHoursToFirstComment: enoughSamples
          ? (review?.medianHoursToFirstComment ?? null)
          : null,
        p90HoursToFirstComment: enoughSamples
          ? (review?.p90HoursToFirstComment ?? null)
          : null,
        comments: review?.comments ?? 0,
      };
    });

    // Counts sum exactly across buckets, so the window total for completions is
    // taken from the same rows the trend is drawn from — one source, so the KPI
    // and the chart cannot disagree. The percentiles come from their own
    // whole-window pass, because a median of medians is not a median.
    const completedSessions = points.reduce(
      (sum, p) => sum + p.completedSessions,
      0,
    );
    const summaryEnoughSamples =
      totals.reviewsWithComment >= MIN_COACHING_SAMPLE_SIZE;

    return {
      window: describeWindow(window),
      points,
      summary: {
        sharedSessions: totals.sharedSessions,
        completedSessions,
        sharePct:
          completedSessions > 0
            ? round1((totals.sharedSessions / completedSessions) * 100)
            : null,
        reviewsWithComment: totals.reviewsWithComment,
        respondedPct:
          totals.sharedSessions > 0
            ? round1((totals.reviewsWithComment / totals.sharedSessions) * 100)
            : null,
        medianHoursToFirstComment: summaryEnoughSamples
          ? totals.medianHoursToFirstComment
          : null,
        p90HoursToFirstComment: summaryEnoughSamples
          ? totals.p90HoursToFirstComment
          : null,
        comments: totals.comments,
      },
      minSampleSize: MIN_COACHING_SAMPLE_SIZE,
      // Reviews, threads, comments and sessions all carry a tenant, so unlike AI
      // cost or org counts there is nothing here that has to stay platform-wide
      // under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
