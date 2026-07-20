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

const MS_PER_DAY = 86_400_000;

/**
 * UTC calendar math mirroring PlatformAnalyticsService: `date_trunc` on the
 * tz-naive timestamp columns is pure calendar math, so the repository's
 * yyyy-mm-dd keys line up with this UTC-generated axis regardless of the Node
 * timezone.
 */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function addMonths(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate()),
  );
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** ISO week start (Monday 00:00 UTC), matching Postgres `date_trunc('week')`. */
function startOfUtcWeekMonday(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0=Sun .. 6=Sat
  const offset = (dow + 6) % 7; // days since Monday
  return addDays(day, -offset);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const endExclusive = addDays(todayStart, 1);

    let windowStart: Date;
    let bucket: AnalyticsBucket;
    if (range === '30d') {
      windowStart = addDays(todayStart, -29);
      bucket = 'day';
    } else if (range === '90d') {
      windowStart = addDays(todayStart, -89);
      bucket = 'week';
    } else {
      windowStart = startOfUtcMonth(addMonths(todayStart, -11));
      bucket = 'month';
    }

    this.logger.info(
      `Building organization metrics tenant=${tenantId} range=${range} ` +
        `window=[${isoDate(windowStart)},${isoDate(endExclusive)})`,
    );

    const [
      simulationsCompleted,
      activeUsers,
      simulationsByBucket,
      activeUsersByBucket,
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
    ]);

    const axis = this.buildBucketAxis(windowStart, endExclusive, bucket);

    return {
      range,
      bucket,
      summary: { simulationsCompleted, activeUsers },
      simulationsCompletedTrend: this.zeroFill(axis, simulationsByBucket),
      activeUsersTrend: this.zeroFill(axis, activeUsersByBucket),
    };
  }

  /** Every bucket start (yyyy-mm-dd) covering [start, end). */
  private buildBucketAxis(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): string[] {
    const axis: string[] = [];
    let cursor =
      bucket === 'day'
        ? startOfUtcDay(start)
        : bucket === 'week'
          ? startOfUtcWeekMonday(start)
          : startOfUtcMonth(start);
    while (cursor < end) {
      axis.push(isoDate(cursor));
      cursor =
        bucket === 'day'
          ? addDays(cursor, 1)
          : bucket === 'week'
            ? addDays(cursor, 7)
            : startOfUtcMonth(addMonths(cursor, 1));
    }
    return axis;
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
