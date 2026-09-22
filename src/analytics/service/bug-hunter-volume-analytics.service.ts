import { Injectable } from '@nestjs/common';

import {
  BugHunterVolumeAnalyticsRepository,
  BugHunterVolumeBucketRow,
} from '../repository/bug-hunter-volume-analytics.repository';
import {
  BugHunterVolumePointDto,
  BugHunterVolumeQueryDto,
  BugHunterVolumeResponseDto,
} from '../dto/bug-hunter-volume-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** 90 days by default, matching `BugAgentPerformanceAnalyticsService`, the closest sibling. */
const DEFAULT_RANGE: AnalyticsRange = '90d';

/** 30d/90d in weekly buckets, 12m/all in monthly — the shared `ANALYTICS_RANGES` ladder. */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' || range === 'all' ? 'month' : 'week';

/**
 * Bug Hunter's found vs. fixed volume, per bucket.
 *
 * Two independent queries rather than one funnel query: "found" and "fixed"
 * are bucketed by two different timestamps on two different sets of rows (see
 * the repository doc comment) and are not a before/after pair on the same
 * findings within one bucket — a bug found this week is routinely fixed in a
 * later one. Reporting them side by side on a shared bucket axis is exactly
 * what shows whether the fix rate is keeping pace with the find rate, without
 * implying a false per-bucket funnel.
 */
@Injectable()
export class BugHunterVolumeAnalyticsService {
  constructor(
    private readonly repository: BugHunterVolumeAnalyticsRepository,
  ) {}

  async getVolume(
    query: BugHunterVolumeQueryDto,
  ): Promise<BugHunterVolumeResponseDto> {
    const range = query.range ?? DEFAULT_RANGE;
    const isAllTime = range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(
      { range, bucket: query.bucket, from: query.from, to: query.to },
      {
        defaultRange: DEFAULT_RANGE,
        defaultBucketFor,
        allTimeStart: isAllTime
          ? await this.repository.getDataFloor()
          : undefined,
      },
    );

    const [foundRows, fixedRows] = await Promise.all([
      this.repository.getFoundByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
      ),
      this.repository.getFixedByBucket(
        window.start,
        window.endExclusive,
        window.bucket,
      ),
    ]);

    return {
      window: describeWindow(window),
      points: this.buildPoints(foundRows, fixedRows, window),
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  private buildPoints(
    foundRows: BugHunterVolumeBucketRow[],
    fixedRows: BugHunterVolumeBucketRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
  ): BugHunterVolumePointDto[] {
    const foundByBucket = new Map(foundRows.map((r) => [r.bucket, r.count]));
    const fixedByBucket = new Map(fixedRows.map((r) => [r.bucket, r.count]));

    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => ({
      bucket,
      found: foundByBucket.get(bucket) ?? 0,
      fixed: fixedByBucket.get(bucket) ?? 0,
    }));
  }
}
