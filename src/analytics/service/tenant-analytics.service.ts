import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  LearnerUsageQueryDto,
  LearnerUsageResponseDto,
  LearnerUsageRowDto,
  LearnerUsageStatus,
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
const MS_PER_DAY = 86_400_000;
/** Round to 1 decimal place — enough precision for an "avg X per Y" tile. */
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Top-N cap for the most-used-simulations ranked list. */
const MOST_USED_SIMULATIONS_LIMIT = 5;
/** Default page size for the per-learner usage table. */
const DEFAULT_LEARNER_USAGE_LIMIT = 25;

/**
 * Learner-usage status thresholds, in days since the last roleplay session.
 * A first cut, easy to retune once we see how tenant admins actually read
 * the table — not derived from any product spec.
 */
const ACTIVE_WITHIN_DAYS = 14;
const AT_RISK_WITHIN_DAYS = 30;

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

  /**
   * Per-learner usage table for one tenant. Unlike every other method in this
   * service, this deliberately returns identifiable, row-level data (name,
   * email) rather than an aggregate — that's the point of the feature (spot
   * *which* learners aren't using Ally), not an oversight of the aggregation
   * conventions used elsewhere in this file.
   */
  async getLearnerUsage(
    tenantId: string,
    query: LearnerUsageQueryDto,
  ): Promise<LearnerUsageResponseDto> {
    const range: AnalyticsRange = query.range ?? '30d';
    const allTimeStart =
      range === 'all'
        ? await this.repo.getTenantDataFloor(tenantId)
        : undefined;
    const { start, endExclusive } = resolveAnalyticsWindow(
      { range },
      { defaultRange: '30d', defaultBucketFor: () => 'month', allTimeStart },
    );

    const limit = query.limit ?? DEFAULT_LEARNER_USAGE_LIMIT;
    const offset = query.offset ?? 0;

    const { rows, count } = await this.repo.getLearnerUsageRows(
      tenantId,
      start,
      endExclusive,
      {
        search: query.search,
        sortBy: query.sortBy,
        order: query.order,
        limit,
        offset,
      },
    );

    const now = new Date();
    const data: LearnerUsageRowDto[] = rows.map((r) => {
      const daysSinceLastActivity = r.lastPracticeSessionAt
        ? Math.floor(
            (now.getTime() - r.lastPracticeSessionAt.getTime()) / MS_PER_DAY,
          )
        : null;

      let status: LearnerUsageStatus;
      if (daysSinceLastActivity == null) status = 'never_started';
      else if (daysSinceLastActivity <= ACTIVE_WITHIN_DAYS) status = 'active';
      else if (daysSinceLastActivity <= AT_RISK_WITHIN_DAYS) status = 'at_risk';
      else status = 'dormant';

      return {
        id: r.id,
        name: r.name,
        email: r.email,
        signupDate: r.signupDate,
        lastPracticeSessionAt: r.lastPracticeSessionAt,
        daysSinceLastActivity,
        status,
        roleplaySessionsStarted: r.roleplaySessionsStarted,
        roleplaySessionsCompleted: r.roleplaySessionsCompleted,
        roleplayCompletionRatePct:
          r.roleplaySessionsStarted > 0
            ? round1(
                (r.roleplaySessionsCompleted / r.roleplaySessionsStarted) * 100,
              )
            : null,
        avgScore: r.avgScore != null ? round1(r.avgScore) : null,
        totalPracticeMinutes: round1(r.totalDurationMs / MS_PER_MINUTE),
        coursesAssigned: r.coursesAssigned,
        coursesStarted: r.coursesStarted,
        coursesCompleted: r.coursesCompleted,
        courseCompletionRatePct:
          r.coursesAssigned > 0
            ? round1((r.coursesCompleted / r.coursesAssigned) * 100)
            : null,
      };
    });

    return { range, data, count };
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
