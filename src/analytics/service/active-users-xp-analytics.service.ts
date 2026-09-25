import { Injectable } from '@nestjs/common';

import {
  ActiveUsersXpAnalyticsRepository,
  ActiveUsersXpBucketRow,
} from '../repository/active-users-xp-analytics.repository';
import {
  ActiveUsersXpPointDto,
  ActiveUsersXpQueryDto,
  ActiveUsersXpResponseDto,
} from '../dto/active-users-xp-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

/** 90 days by default — long enough to show a trend, short enough to stay legible. */
const DEFAULT_RANGE: AnalyticsRange = '90d';

/**
 * 30d/90d in weekly buckets, 12m/all in monthly — the same range→bucket ladder
 * documented on `ANALYTICS_RANGES` and used by every sibling window-based chart.
 */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '12m' || range === 'all' ? 'month' : 'week';

/**
 * Active users by XP threshold, for Highlights → Goals.
 *
 * "Active" is a product-chosen floor (`ACTIVE_USER_XP_THRESHOLD`, currently
 * 100 XP), evaluated PER BUCKET rather than as a lifetime figure — a learner
 * who banks 100 XP in one busy week and nothing since should read as active
 * that week and inactive since, not as permanently active from the day they
 * crossed the bar once. This is deliberately a different question from the
 * platform overview's DAU/WAU/MAU, which count any activity at all; this chart
 * asks whether that activity was substantial enough to matter.
 */
@Injectable()
export class ActiveUsersXpAnalyticsService {
  constructor(private readonly repository: ActiveUsersXpAnalyticsRepository) {}

  async getActiveUsers(
    query: ActiveUsersXpQueryDto,
  ): Promise<ActiveUsersXpResponseDto> {
    const range = query.range ?? DEFAULT_RANGE;
    // The data floor is one extra cheap query, and only for an all-time range.
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

    const rows = await this.repository.getActiveUsersByBucket(
      window.start,
      window.endExclusive,
      window.bucket,
    );

    return {
      window: describeWindow(window),
      points: this.buildPoints(rows, window),
      // Platform-wide leadership chart — no tenant filter is offered, matching
      // ship-volume and roadmap-delivery's precedent for this class of chart.
      scoping: { tenantId: null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /** The gap-free series: every bucket in the window, absent ones filled with a real zero. */
  private buildPoints(
    rows: ActiveUsersXpBucketRow[],
    window: { start: Date; endExclusive: Date; bucket: AnalyticsBucket },
  ): ActiveUsersXpPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r]));
    return generateBucketLabels(
      window.start,
      window.endExclusive,
      window.bucket,
    ).map((bucket) => ({
      bucket,
      activeUsers: byBucket.get(bucket)?.activeUsers ?? 0,
    }));
  }
}
