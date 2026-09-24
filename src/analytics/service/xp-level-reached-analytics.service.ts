import { Injectable } from '@nestjs/common';

import {
  XpLevelCrossingRow,
  XpLevelReachedAnalyticsRepository,
} from '../repository/xp-level-reached-analytics.repository';
import {
  XpLevelReachedBucketParam,
  XpLevelReachedPointDto,
  XpLevelReachedQueryDto,
  XpLevelReachedResponseDto,
} from '../dto/xp-level-reached-analytics.dto';
import {
  AnalyticsBucketParam,
  AnalyticsRange,
} from '../dto/platform-analytics.dto';
import { MAX_LEVEL } from 'src/progress/progress.constants';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  isoDate,
  resolveAnalyticsWindow,
  truncToBucket,
} from '../util/analytics-window.util';

/** 90 days by default — long enough to show a trend, short enough to stay legible. */
const DEFAULT_RANGE: AnalyticsRange = '90d';

/**
 * 30d/90d in weekly buckets, 12m/all in monthly — the same range→bucket ladder
 * documented on `ANALYTICS_RANGES`. `quarter` is never the DEFAULT (only an
 * explicit `bucket=quarter` selects it); this only decides what happens with no
 * `bucket` supplied at all.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' || range === 'all' ? 'month' : 'week';

/**
 * Unique users reaching each XP level for the first time, per bucket.
 *
 * The repository computes crossings from a learner's WHOLE ledger history (it
 * has to, to know whether a crossing genuinely happened for the first time
 * during the requested window or earlier) and returns every crossing through
 * `window.endExclusive`. This service does the two things that must not be
 * left to the repository: it drops any crossing that happened BEFORE
 * `window.start` (real, but outside the period being charted), and it
 * gap-fills the axis so every bucket carries a `users` figure for every level
 * 1..MAX_LEVEL, not just the ones with observed crossings.
 */
@Injectable()
export class XpLevelReachedAnalyticsService {
  constructor(private readonly repository: XpLevelReachedAnalyticsRepository) {}

  async getLevelsReached(
    query: XpLevelReachedQueryDto,
  ): Promise<XpLevelReachedResponseDto> {
    const range = query.range ?? DEFAULT_RANGE;
    const isAllTime = range === 'all';
    const window = resolveAnalyticsWindow(
      {
        range,
        // `XP_LEVEL_REACHED_BUCKETS` is a superset of the shared
        // `AnalyticsBucketParam` (it adds `quarter`). `resolveAnalyticsWindow`
        // never validates bucket membership — it only threads the value
        // through to `generateBucketLabels`, which already accepts the wider
        // `AnalyticsBucket` type — so this cast is safe at runtime; it exists
        // only because the shared `WindowQuery` type is narrower than what
        // this endpoint's DTO allows.
        bucket: query.bucket as AnalyticsBucketParam | undefined,
        from: isAllTime ? undefined : query.from,
        to: isAllTime ? undefined : query.to,
      },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const rows = await this.repository.getLevelCrossings(
      window.endExclusive,
      // Same acknowledged-unsafe cast as the `bucket` input above, in the
      // other direction: `AnalyticsWindow.bucket` is typed as the narrower
      // shared `AnalyticsBucket` (no `quarter`), but at runtime carries
      // whatever `query.bucket` supplied, including `quarter` for this
      // endpoint's wider DTO.
      window.bucket as XpLevelReachedBucketParam,
    );

    return {
      window: describeWindow(window),
      points: this.buildPoints(rows, window),
      // Platform-wide leadership chart — no tenant filter is offered.
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  private buildPoints(
    rows: XpLevelCrossingRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
  ): XpLevelReachedPointDto[] {
    // The repository reads a learner's whole history to find each crossing's
    // TRUE first bucket, so it can return crossings from before this window —
    // those are real, but happened outside the period being charted, and are
    // dropped here rather than in SQL.
    const startIso = isoDate(truncToBucket(window.start, window.bucket));
    const inWindow = rows.filter((r) => r.bucket >= startIso);

    const byBucket = new Map<string, Map<number, number>>();
    for (const row of inWindow) {
      const levels = byBucket.get(row.bucket) ?? new Map<number, number>();
      levels.set(row.level, row.users);
      byBucket.set(row.bucket, levels);
    }

    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => {
      const levels = byBucket.get(bucket);
      return {
        bucket,
        levelCounts: Array.from({ length: MAX_LEVEL }, (_, i) => ({
          level: i + 1,
          users: levels?.get(i + 1) ?? 0,
        })),
      };
    });
  }
}
