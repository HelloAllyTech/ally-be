import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import {
  CourseUsageQueryDto,
  CourseUsageResponseDto,
  CourseUsageRowDto,
  LearnerUsageQueryDto,
  LearnerUsageResponseDto,
  LearnerUsageRowDto,
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
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

const MS_PER_MINUTE = 60_000;
/** Round to 1 decimal place — enough precision for an "avg X per Y" tile. */
const round1 = (n: number): number => Math.round(n * 10) / 10;
/** Top-N cap for the most-used-simulations ranked list. */
const MOST_USED_SIMULATIONS_LIMIT = 5;
/** Default page size for the per-learner usage table. */
const DEFAULT_LEARNER_USAGE_LIMIT = 25;

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
      withReportingQuerySlot(() =>
        this.repo.getCompletedSimulationCount(
          tenantId,
          windowStart,
          endExclusive,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getActiveUserCount(tenantId, windowStart, endExclusive),
      ),
      withReportingQuerySlot(() =>
        this.repo.getCompletedSimulationsByBucket(
          tenantId,
          windowStart,
          endExclusive,
          bucket,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getActiveUsersByBucket(
          tenantId,
          windowStart,
          endExclusive,
          bucket,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getNewLearnersOnboardedCount(
          tenantId,
          windowStart,
          endExclusive,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getNewLearnersOnboardedByBucket(
          tenantId,
          windowStart,
          endExclusive,
          bucket,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getTotalRegisteredLearnersCount(tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repo.getSessionEngagementTotals(
          tenantId,
          windowStart,
          endExclusive,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getTimeToFirstSessionStats(
          tenantId,
          windowStart,
          endExclusive,
        ),
      ),
      withReportingQuerySlot(() =>
        this.repo.getMostUsedSimulations(
          tenantId,
          windowStart,
          endExclusive,
          MOST_USED_SIMULATIONS_LIMIT,
        ),
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
        statuses: query.status,
        sortBy: query.sortBy,
        order: query.order,
        limit,
        offset,
      },
    );

    // `status` and `daysSinceLastActivity` arrive already derived: the status
    // facet has to filter before LIMIT/OFFSET or `count` would describe the
    // unfiltered set, so the repository owns that arithmetic and this layer
    // only shapes the response. See getLearnerUsageRows.
    const data: LearnerUsageRowDto[] = rows.map((r) => {
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        signupDate: r.signupDate,
        lastPracticeSessionAt: r.lastPracticeSessionAt,
        lastActivityAt: r.lastActivityAt,
        daysSinceLastActivity: r.daysSinceLastActivity,
        status: r.status,
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
        roleplayPointsPerMinute:
          r.roleplayPointsPerMinute != null
            ? round1(r.roleplayPointsPerMinute)
            : null,
        coursesAssigned: r.coursesAssigned,
        coursesStarted: r.coursesStarted,
        coursesCompleted: r.coursesCompleted,
        courseCompletionRatePct:
          r.coursesAssigned > 0
            ? round1((r.coursesCompleted / r.coursesAssigned) * 100)
            : null,
        level: r.level,
        totalXp: r.totalXp,
        itemsTotal: r.itemsTotal,
        itemsCompleted: r.itemsCompleted,
        itemsCompletedPct:
          r.itemsCompletedPct != null ? round1(r.itemsCompletedPct) : null,
        quizzesPassed: r.quizzesPassed,
        quizzesAttempted: r.quizzesAttempted,
        avgQuizScorePct:
          r.avgQuizScorePct != null ? round1(r.avgQuizScorePct) : null,
        readWatchCompleted: r.readWatchCompleted,
        reflectionCompleted: r.reflectionCompleted,
      };
    });

    return { range, data, count };
  }

  /**
   * Per-course usage table for one tenant: one row per Track 2.0 course
   * visible to the tenant, all-time. See {@link TenantAnalyticsRepository.getCourseUsageRows}
   * for why "assigned" means the tenant's learner headcount rather than a
   * per-course assignment count.
   */
  async getCourseUsage(
    tenantId: string,
    query: CourseUsageQueryDto,
  ): Promise<CourseUsageResponseDto> {
    const limit = query.limit ?? DEFAULT_LEARNER_USAGE_LIMIT;
    const offset = query.offset ?? 0;

    const { rows, count } = await this.repo.getCourseUsageRows(tenantId, {
      search: query.search,
      sortBy: query.sortBy,
      order: query.order,
      limit,
      offset,
    });

    const data: CourseUsageRowDto[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      totalItems: r.totalItems,
      learnersAssigned: r.learnersAssigned,
      learnersStarted: r.learnersStarted,
      startedRatePct:
        r.learnersAssigned > 0
          ? round1((r.learnersStarted / r.learnersAssigned) * 100)
          : null,
      learnersAtLeast50: r.learnersAtLeast50,
      completion50PlusRatePct:
        r.learnersStarted > 0
          ? round1((r.learnersAtLeast50 / r.learnersStarted) * 100)
          : null,
      learnersCompleted100: r.learnersCompleted100,
      completion100RatePct:
        r.learnersStarted > 0
          ? round1((r.learnersCompleted100 / r.learnersStarted) * 100)
          : null,
      avgCompletionDays:
        r.avgCompletionDays != null ? round1(r.avgCompletionDays) : null,
      medianCompletionDays:
        r.medianCompletionDays != null ? round1(r.medianCompletionDays) : null,
      avgScore: r.avgScore != null ? round1(r.avgScore) : null,
      inProgressActive: r.inProgressActive,
      inProgressStalled: r.inProgressStalled,
      lastEnrollmentAt: r.lastEnrollmentAt,
    }));

    return { data, count };
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
