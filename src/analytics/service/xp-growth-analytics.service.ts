import { Injectable } from '@nestjs/common';

import {
  XpBucketRow,
  XpGrowthAnalyticsRepository,
} from '../repository/xp-growth-analytics.repository';
import {
  XpGrowthPointDto,
  XpGrowthQueryDto,
  XpGrowthResponseDto,
  XpGrowthSummaryDto,
} from '../dto/xp-growth-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/**
 * All of history by default. A cumulative total over the last 30 days is a
 * straight-ish line with an arbitrary starting height; the question the chart
 * answers is how the platform's XP has grown, which needs the whole history.
 */
const DEFAULT_RANGE: AnalyticsRange = 'all';

/**
 * Monthly buckets by default, for every range rather than a per-range ladder.
 *
 * The grain is a per-chart control on the surface (day / week / month / year),
 * so this is only the opening choice. Month is the conservative one: an all-time
 * window is years wide and a daily axis over it is a thousand ticks nobody reads.
 */
const DEFAULT_BUCKET: AnalyticsBucket = 'month';

/**
 * Cumulative platform XP for the leadership surface.
 *
 * Thin by design — the repository sums the ledger per bucket and this service
 * applies the three rules that must not be left to a client:
 *
 *  - **The axis is a real calendar.** Every bucket in the window is present and
 *    in order, so two adjacent points are always one bucket apart. A series
 *    assembled only from the buckets that had awards invites the reader to
 *    compare a week with a quarter later.
 *  - **An empty bucket is a real zero, and the running total carries forward.**
 *    Nothing was earned is a measurement, not a gap; and a cumulative series
 *    that skipped the period would fall, which is the one thing a lifetime total
 *    cannot do.
 *  - **The curve opens at the baseline, not at zero.** XP earned before the
 *    window is fetched once — for every window, all-time included — and added
 *    to every point, so narrowing the window narrows what is shown without
 *    redefining the quantity. The alternative — starting each window at zero —
 *    turns "lifetime XP" into "XP since an arbitrary date" while leaving the
 *    axis label saying otherwise.
 *
 * The per-bucket `xpEarned` and `earners` travel alongside deliberately. A
 * cumulative count of an action can only go up, which makes it the easiest kind
 * of metric to present as progress; the change and the number of people behind
 * it are what let a reader tell real growth from an accumulating denominator.
 */
@Injectable()
export class XpGrowthAnalyticsService {
  constructor(private readonly repository: XpGrowthAnalyticsRepository) {}

  async getXpGrowth(query: XpGrowthQueryDto): Promise<XpGrowthResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const range = query.range ?? DEFAULT_RANGE;
    // The data floor is one extra cheap query, and only for an all-time range.
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

    const [rows, totals, baselineXp] = await Promise.all([
      this.repository.getXpByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
        tenantId,
      ),
      this.repository.getWindowTotals(
        window.start,
        window.endExclusive,
        tenantId,
      ),
      // Queried for EVERY window, all-time included.
      //
      // The tempting shortcut — "an all-time window starts at the platform's
      // first row, so nothing can precede it, return 0" — is an assumption
      // about the data, not a fact about the window. The floor is measured from
      // `users` and `scenario_sessions`; an award dated before the earliest
      // surviving row of either (a deleted account's history, a seeded or
      // migrated ledger row) would then be dropped from the chart AND left out
      // of the opening balance, so a total labelled "lifetime XP" would
      // understate the ledger with nothing on the surface to say so. Measured,
      // that XP becomes the curve's opening value instead: the axis still
      // starts where every other chart on the tab starts, and no award goes
      // missing. One cheap aggregate is a fair price for a total that is
      // actually total.
      this.repository.getXpBefore(window.start, tenantId),
    ]);

    const points = this.buildPoints(rows, window, baselineXp);

    return {
      window: describeWindow(window),
      points,
      summary: this.buildSummary(baselineXp, totals),
      // Every XP event carries a tenant, so there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The gap-free series, with the running total accumulated across it.
   *
   * Accumulated here rather than in SQL: a window function would have to run
   * over the gap-filled axis to carry an empty bucket's total forward, and the
   * axis is generated in JS. Doing both in one place keeps the invariant
   * (`cumulativeXp` is non-decreasing and its last value equals
   * `baselineXp + xpEarnedInWindow`) checkable in one function.
   */
  private buildPoints(
    rows: XpBucketRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
    baselineXp: number,
  ): XpGrowthPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    let running = baselineXp;

    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => {
      const row = byBucket.get(bucket);
      const xpEarned = row?.xpEarned ?? 0;
      running += xpEarned;
      return {
        bucket,
        xpEarned,
        cumulativeXp: running,
        earners: row?.earners ?? 0,
      };
    });
  }

  /**
   * Whole-window totals.
   *
   * `xpEarnedInWindow` comes from the same aggregate as `earners` rather than
   * from summing the plotted buckets: one query cannot disagree with itself
   * about which ledger rows it covered, and the learner count is not summable
   * from buckets at all.
   */
  private buildSummary(
    baselineXp: number,
    totals: { xp: number; earners: number },
  ): XpGrowthSummaryDto {
    return {
      baselineXp,
      xpEarnedInWindow: totals.xp,
      cumulativeXp: baselineXp + totals.xp,
      earners: totals.earners,
    };
  }
}
