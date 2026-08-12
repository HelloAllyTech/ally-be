import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  OrganizationMetricsResponseDto,
  OrganizationMetricsTrendPointDto,
} from '../dto/tenant-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import {
  BucketCountRow,
  TenantAnalyticsRepository,
} from '../repository/tenant-analytics.repository';
import {
  generateBucketLabels,
  isoDate,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';

const MS_PER_MINUTE = 60_000;
/** Round to 1 decimal place — enough precision for an "avg X per Y" tile. */
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Top-N cap for the most-used-simulations ranked list. */
const MOST_USED_SIMULATIONS_LIMIT = 5;

/**
 * Bucket granularity per preset — the dashboard's existing axis, kept as an
 * explicit map so `resolveAnalyticsWindow` reproduces it exactly. `all` is
 * bucketed by month by the util itself (a daily axis over years of history is
 * a thousand unreadable ticks).
 */
const DEFAULT_BUCKET_FOR: Record<AnalyticsRange, AnalyticsBucket> = {
  '30d': 'day',
  '90d': 'week',
  '12m': 'month',
  all: 'month',
};

@Injectable()
export class TenantAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    TenantAnalyticsService.name,
  );

  constructor(private readonly repo: TenantAnalyticsRepository) {}

  /**
   * Organization Metrics for one tenant: window totals plus zero-filled
   * per-bucket trends for each metric. New organization metrics should be
   * added here (and to the response DTO) so the dashboard grows without
   * another endpoint.
   */
  async getOrganizationMetrics(
    tenantId: string,
    range: AnalyticsRange,
  ): Promise<OrganizationMetricsResponseDto> {
    // `all` runs from this tenant's own first row, measured rather than
    // guessed — and measured per tenant, so an organization that joined last
    // month doesn't get an axis stretching back to the platform's first
    // account. Only queried for that range; the presets are pure calendar math.
    const allTimeStart =
      range === 'all'
        ? await this.repo.getTenantDataFloor(tenantId)
        : undefined;

    const {
      start: windowStart,
      endExclusive,
      bucket,
    } = resolveAnalyticsWindow(
      { range },
      {
        defaultRange: '30d',
        defaultBucketFor: (r) => DEFAULT_BUCKET_FOR[r],
        allTimeStart,
      },
    );

    this.logger.info(
      `Building organization metrics tenant=${tenantId} range=${range} ` +
        `window=[${isoDate(windowStart)},${isoDate(endExclusive)})`,
    );

    const [
      simulationsCompleted,
      activeUsers,
      simulationsByBucket,
      activeUsersByBucket,
      newLearnersOnboarded,
      newLearnersOnboardedByBucket,
      totalRegisteredLearners,
      engagementTotals,
      timeToFirstSession,
      mostUsedSimulations,
    ] = await Promise.all([
      this.repo.getCompletedSimulationCount(
        tenantId,
        windowStart,
        endExclusive,
      ),
      this.repo.getActiveUserCount(tenantId, windowStart, endExclusive),
      this.repo.getCompletedSimulationsByBucket(
        tenantId,
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getActiveUsersByBucket(
        tenantId,
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getNewLearnersOnboardedCount(
        tenantId,
        windowStart,
        endExclusive,
      ),
      this.repo.getNewLearnersOnboardedByBucket(
        tenantId,
        windowStart,
        endExclusive,
        bucket,
      ),
      this.repo.getTotalRegisteredLearnersCount(tenantId),
      this.repo.getSessionEngagementTotals(tenantId, windowStart, endExclusive),
      this.repo.getTimeToFirstSessionStats(tenantId, windowStart, endExclusive),
      this.repo.getMostUsedSimulations(
        tenantId,
        windowStart,
        endExclusive,
        MOST_USED_SIMULATIONS_LIMIT,
      ),
    ]);

    const axis = generateBucketLabels(windowStart, endExclusive, bucket);

    const avgSessionsPerActiveLearner =
      engagementTotals.activeLearners > 0
        ? round1(
            engagementTotals.totalSessions / engagementTotals.activeLearners,
          )
        : null;
    const avgPracticeMinutesPerLearner =
      engagementTotals.activeLearners > 0
        ? round1(
            engagementTotals.totalDurationMs /
              engagementTotals.activeLearners /
              MS_PER_MINUTE,
          )
        : null;

    return {
      range,
      bucket,
      summary: {
        simulationsCompleted,
        activeUsers,
        newLearnersOnboarded,
        totalRegisteredLearners,
        avgSessionsPerActiveLearner,
        avgPracticeMinutesPerLearner,
        avgDaysToFirstSession:
          timeToFirstSession.avgDays != null
            ? round1(timeToFirstSession.avgDays)
            : null,
        learnersWithFirstSessionCount: timeToFirstSession.learnerCount,
      },
      simulationsCompletedTrend: this.zeroFill(axis, simulationsByBucket),
      activeUsersTrend: this.zeroFill(axis, activeUsersByBucket),
      newLearnersOnboardedTrend: this.zeroFill(
        axis,
        newLearnersOnboardedByBucket,
      ),
      mostUsedSimulations,
    };
  }

  private zeroFill(
    axis: string[],
    rows: BucketCountRow[],
  ): OrganizationMetricsTrendPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r.count]));
    return axis.map((bucket) => ({
      bucket,
      count: byBucket.get(bucket) ?? 0,
    }));
  }
}
