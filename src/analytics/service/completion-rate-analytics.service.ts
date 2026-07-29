import { Injectable } from '@nestjs/common';

import {
  CompletionRateAnalyticsRepository,
  CompletionRateBucketRow,
} from '../repository/completion-rate-analytics.repository';
import {
  CompletionRatePointDto,
  CompletionRateQueryDto,
  CompletionRateResponseDto,
  CompletionRateSummaryDto,
} from '../dto/completion-rate-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * All of history by default: whether learners finish what they start is a slow
 * behavioural quantity, and its interesting feature is the trend across releases
 * rather than this month's level.
 */
const DEFAULT_RANGE: AnalyticsRange = 'all';

/**
 * Monthly buckets by default, for every range rather than a per-range ladder.
 *
 * This series is a RATIO, and a ratio needs a denominator worth dividing: a daily
 * completion rate over eleven launches swings twenty points on one learner closing
 * a laptop, and the eye reads that noise as a trend. A coarse default is the
 * conservative one — a client that knows its volume can ask for `bucket=day`.
 */
const DEFAULT_BUCKET: AnalyticsBucket = 'month';

/**
 * Simulation completion rate for the leadership surface.
 *
 * Thin by design — the repository returns the two counts per bucket and this
 * service applies the three rules that must not be left to a client:
 *
 *  - **A rate over a zero denominator is undefined, not 0%.** A bucket with no
 *    launches keeps its real zero COUNTS (nothing was launched — that is a
 *    measurement) and its rate is null. Gap-filling the rate with zero would draw
 *    a collapse in completion during a period when nobody practised at all, which
 *    is the single most common way a well-meaning chart lies.
 *  - **The axis is a real calendar.** Every bucket in the window is present and in
 *    order, so two adjacent points are always one bucket apart. A points list
 *    assembled from the buckets that happened to have activity invites the reader
 *    to compare a Tuesday with a fortnight later.
 *  - **The window rate is computed from the totals, not averaged from the
 *    buckets.** A mean of per-bucket rates weights a quiet week the same as a busy
 *    one; counts are additive, rates are not.
 */
@Injectable()
export class CompletionRateAnalyticsService {
  constructor(private readonly repository: CompletionRateAnalyticsRepository) {}

  async getCompletionRate(
    query: CompletionRateQueryDto,
  ): Promise<CompletionRateResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const range = query.range ?? DEFAULT_RANGE;
    // The data floor is one extra cheap query, and only for an all-time range. An
    // endpoint that has not measured its floor must let the window util reject
    // `range=all` rather than guess an epoch and put an invented history on the
    // left of the axis; here it is measured, so the range is supported.
    const isAllTime = range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(
      { range, bucket: query.bucket, from: query.from, to: query.to },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor: () => DEFAULT_BUCKET,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const rows = await this.repository.getStartedVsCompletedByBucket(
      window.start,
      window.endExclusive,
      window.bucket,
      tenantId,
    );

    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    const points: CompletionRatePointDto[] = generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => this.buildPoint(bucket, byBucket.get(bucket)));

    return {
      window: describeWindow(window),
      points,
      summary: this.buildSummary(rows),
      // Sessions carry a tenant, so there is nothing here that has to stay
      // platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * One point, including the empty ones.
   *
   * The asymmetry is the point: the counts gap-fill to zero and the rate does not.
   * "No simulations were launched that month" is a fact worth plotting; "0% of them
   * were completed" is a statement about a population that does not exist.
   *
   * `abandoned` is clamped at zero so a data anomaly — more completions than
   * launches, which the cohort attribution makes possible if a launch row is ever
   * deleted after its completion — renders as an odd zero rather than as a negative
   * segment pointing the wrong way out of a stacked bar.
   */
  private buildPoint(
    bucket: string,
    row: CompletionRateBucketRow | undefined,
  ): CompletionRatePointDto {
    const started = row?.started ?? 0;
    const completed = row?.completed ?? 0;
    return {
      bucket,
      started,
      completed,
      abandoned: Math.max(0, started - completed),
      completionRatePct: this.ratePct(completed, started),
    };
  }

  /**
   * Whole-window totals, summed from the measured buckets.
   *
   * Summing the repository rows rather than issuing a second aggregate query is
   * deliberate: counts are additive, so the sum is exact, and one query cannot
   * disagree with itself about how many sessions were launched. The rate is then
   * taken over those totals — never as the mean of the per-bucket rates.
   */
  private buildSummary(
    rows: CompletionRateBucketRow[],
  ): CompletionRateSummaryDto {
    const started = rows.reduce((a, r) => a + r.started, 0);
    const completed = rows.reduce((a, r) => a + r.completed, 0);
    return {
      started,
      completed,
      abandoned: Math.max(0, started - completed),
      completionRatePct: this.ratePct(completed, started),
    };
  }

  /** The rate, or null when the denominator is zero and the rate is undefined. */
  private ratePct(completed: number, started: number): number | null {
    if (started <= 0) return null;
    return round1((completed / started) * 100);
  }
}
