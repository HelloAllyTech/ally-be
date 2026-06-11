import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  ActiveUsersPointDto,
  AnalyticsOverviewResponseDto,
  AnalyticsRange,
  RetentionPointDto,
  SimulationsCompletedPointDto,
  UserGrowthPointDto,
} from '../dto/platform-analytics.dto';
import {
  AnalyticsBucket,
  DailyActivityRow,
  NewUsersBucketRow,
  PlatformAnalyticsRepository,
  WeeklyActiveUserRow,
  WeeklyCountRow,
} from '../repository/platform-analytics.repository';

const MS_PER_DAY = 86_400_000;

/**
 * All bucketing/axis math is done in UTC. `date_trunc` on the tz-naive
 * `timestamp` columns is pure calendar math, so the repository's `yyyy-mm-dd`
 * keys line up with this UTC-generated axis regardless of the Node timezone.
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

function parseUtcDate(yyyyMmDd: string): Date {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`);
}

@Injectable()
export class PlatformAnalyticsService {
  private readonly logger = LoggerService.getInstance(
    PlatformAnalyticsService.name,
  );

  constructor(private readonly repo: PlatformAnalyticsRepository) {}

  /**
   * Build the consolidated super-admin analytics overview for the given range.
   * - 30d / 90d -> weekly buckets for growth, daily DAU/WAU/MAU series
   * - 12m       -> monthly buckets for growth, daily DAU/WAU/MAU series
   */
  async getOverview(
    range: AnalyticsRange,
  ): Promise<AnalyticsOverviewResponseDto> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    // Exclusive upper bound = start of tomorrow, so all of today is included.
    const endExclusive = addDays(todayStart, 1);

    const bucket: AnalyticsBucket = range === '12m' ? 'month' : 'week';

    let windowStart: Date;
    if (range === '30d') {
      windowStart = addDays(todayStart, -29);
    } else if (range === '90d') {
      windowStart = addDays(todayStart, -89);
    } else {
      windowStart = startOfUtcMonth(addMonths(todayStart, -11));
    }

    // 29-day lookback so trailing 7-/30-day rolls are correct at the left edge.
    const activityStart = addDays(windowStart, -29);

    // Rolling last-30-days window + current ISO week, for the KPI summary.
    const since30 = addDays(now, -30);
    const startOfThisWeek = startOfUtcWeekMonday(now);

    this.logger.info(
      `Building analytics overview range=${range} window=[${isoDate(
        windowStart,
      )},${isoDate(endExclusive)}) bucket=${bucket}`,
    );

    const [
      newUsersBuckets,
      baselineUsers,
      dailyActivity,
      simsByWeek,
      weeklyActive,
      usersByRole,
      totalUsers,
      active30,
      returning30,
      simsThisWeek,
    ] = await Promise.all([
      this.repo.getNewUsersByBucket(windowStart, endExclusive, bucket),
      this.repo.getUserCountBefore(windowStart),
      this.repo.getDailyActivityPairs(activityStart, endExclusive),
      this.repo.getSimulationsCompletedByWeek(windowStart, endExclusive),
      this.repo.getWeeklyActivePairsWithCreatedAt(windowStart, endExclusive),
      this.repo.getUsersByRole(),
      this.repo.getTotalUsers(),
      this.repo.getActiveUserCountSince(since30),
      this.repo.getReturningActiveUserCountSince(since30),
      this.repo.getCompletedSimsSince(startOfThisWeek),
    ]);

    const retentionRatePct =
      active30 > 0
        ? parseFloat(((returning30 / active30) * 100).toFixed(1))
        : 0;

    return {
      summary: {
        totalUsers,
        activeUsers30d: active30,
        simsThisWeek,
        retentionRatePct,
      },
      userGrowth: this.buildUserGrowth(
        newUsersBuckets,
        baselineUsers,
        windowStart,
        endExclusive,
        bucket,
      ),
      activeUsers: this.buildActiveUsers(
        dailyActivity,
        windowStart,
        endExclusive,
      ),
      simulationsCompleted: this.buildSimulationsCompleted(
        simsByWeek,
        windowStart,
        endExclusive,
      ),
      retention: this.buildRetention(weeklyActive, windowStart, endExclusive),
      usersByRole,
    };
  }

  /**
   * Generate a contiguous list of bucket start labels (yyyy-mm-dd) spanning the
   * window, so charts get a gap-free axis even for buckets with zero rows.
   */
  private generateBucketLabels(
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): string[] {
    const lastDay = addDays(endExclusive, -1);
    const labels: string[] = [];

    if (bucket === 'month') {
      let cur = startOfUtcMonth(windowStart);
      const last = startOfUtcMonth(lastDay);
      while (cur <= last) {
        labels.push(isoDate(cur));
        cur = addMonths(cur, 1);
      }
    } else {
      let cur = startOfUtcWeekMonday(windowStart);
      const last = startOfUtcWeekMonday(lastDay);
      while (cur <= last) {
        labels.push(isoDate(cur));
        cur = addDays(cur, 7);
      }
    }

    return labels;
  }

  private buildUserGrowth(
    rows: NewUsersBucketRow[],
    baseline: number,
    windowStart: Date,
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): UserGrowthPointDto[] {
    const byBucket = new Map(rows.map((r) => [r.bucket, r.newUsers]));
    const labels = this.generateBucketLabels(windowStart, endExclusive, bucket);

    let cumulative = baseline;
    return labels.map((date) => {
      const newUsers = byBucket.get(date) ?? 0;
      cumulative += newUsers;
      return { date, newUsers, cumulativeUsers: cumulative };
    });
  }

  private buildActiveUsers(
    rows: DailyActivityRow[],
    windowStart: Date,
    endExclusive: Date,
  ): ActiveUsersPointDto[] {
    const byDay = new Map<string, Set<number>>();
    for (const { day, counselorId } of rows) {
      let set = byDay.get(day);
      if (!set) {
        set = new Set<number>();
        byDay.set(day, set);
      }
      set.add(counselorId);
    }

    const points: ActiveUsersPointDto[] = [];
    for (let d = new Date(windowStart); d < endExclusive; d = addDays(d, 1)) {
      const dayKey = isoDate(d);
      points.push({
        date: dayKey,
        dau: byDay.get(dayKey)?.size ?? 0,
        wau: this.trailingDistinctCount(byDay, d, 7),
        mau: this.trailingDistinctCount(byDay, d, 30),
      });
    }
    return points;
  }

  /** Distinct counselors active within the trailing `n` days ending at `day`. */
  private trailingDistinctCount(
    byDay: Map<string, Set<number>>,
    day: Date,
    n: number,
  ): number {
    const union = new Set<number>();
    for (let i = 0; i < n; i++) {
      const set = byDay.get(isoDate(addDays(day, -i)));
      if (set) {
        for (const id of set) union.add(id);
      }
    }
    return union.size;
  }

  private buildSimulationsCompleted(
    rows: WeeklyCountRow[],
    windowStart: Date,
    endExclusive: Date,
  ): SimulationsCompletedPointDto[] {
    const byWeek = new Map(rows.map((r) => [r.week, r.count]));
    return this.generateBucketLabels(windowStart, endExclusive, 'week').map(
      (weekStart) => ({ weekStart, count: byWeek.get(weekStart) ?? 0 }),
    );
  }

  private buildRetention(
    rows: WeeklyActiveUserRow[],
    windowStart: Date,
    endExclusive: Date,
  ): RetentionPointDto[] {
    const weeks = this.generateBucketLabels(windowStart, endExclusive, 'week');
    const tally = new Map<
      string,
      { newUsers: number; returningUsers: number }
    >();
    for (const w of weeks) tally.set(w, { newUsers: 0, returningUsers: 0 });

    for (const { week, userCreatedAt } of rows) {
      const entry = tally.get(week);
      if (!entry) continue; // outside the visible axis (shouldn't happen)
      const createdWeek = isoDate(
        startOfUtcWeekMonday(parseUtcDate(userCreatedAt)),
      );
      if (createdWeek === week) entry.newUsers += 1;
      else entry.returningUsers += 1;
    }

    return weeks.map((weekStart) => {
      const entry = tally.get(weekStart)!;
      return {
        weekStart,
        newUsers: entry.newUsers,
        returningUsers: entry.returningUsers,
      };
    });
  }
}
