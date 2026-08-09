import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import {
  PracticeStreakResponseDto,
  PracticeStreakSummaryDto,
} from '../dto/practice-streak.dto';
import {
  PracticeStreakCell,
  PracticeStreakGroupBy,
  StreakStatsRow,
} from '../type/practice-streak.type';
import {
  BUSINESS_TIMEZONE,
  toBusinessDateString,
} from 'src/common/util/date.util';
import {
  ACTIVE_DAY_MINUTES,
  DEFAULT_DAILY_GOAL_MINUTES,
} from '../constant/community.constant';
import { TenantService } from 'src/tenant/service/tenant.service';
import { BadgeStreakMilestoneSharedService } from 'src/badge/service/badge-streak-milestone-shared.service';

/** Number of buckets shown by default for each grouping. */
const DEFAULT_BUCKET_COUNT: Record<PracticeStreakGroupBy, number> = {
  [PracticeStreakGroupBy.DAY]: 30, // ~1 month of days
  [PracticeStreakGroupBy.WEEK]: 26, // ~6 months of weeks
  [PracticeStreakGroupBy.MONTH]: 12, // trailing year of months
};

const UNIT_BY_GROUP_BY: Record<
  PracticeStreakGroupBy,
  'day' | 'week' | 'month'
> = {
  [PracticeStreakGroupBy.DAY]: 'day',
  [PracticeStreakGroupBy.WEEK]: 'week',
  [PracticeStreakGroupBy.MONTH]: 'month',
};

@Injectable()
export class PracticeStreakService {
  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
    private readonly tenantService: TenantService,
    private readonly badgeStreakMilestoneSharedService: BadgeStreakMilestoneSharedService,
  ) {}

  /**
   * Daily goal in minutes for a tenant. Clamped to the active-day minimum so a
   * misconfigured tenant can never advertise a goal that fails to protect the
   * streak.
   */
  private async resolveDailyGoalMinutes(tenantId: string): Promise<number> {
    let configured: unknown;
    try {
      const tenant = await this.tenantService.findById(tenantId);
      configured = tenant?.settings?.practiceStreak?.dailyGoalMinutes;
    } catch {
      configured = undefined;
    }

    const goal = Number(configured);
    if (!Number.isFinite(goal) || goal <= 0) {
      return DEFAULT_DAILY_GOAL_MINUTES;
    }
    return Math.max(goal, ACTIVE_DAY_MINUTES);
  }

  private wholeDaysBetween(fromDate: string, toDate: string): number {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const diff =
      Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`);
    return Math.max(1, Math.round(diff / MS_PER_DAY));
  }

  /**
   * Turns the raw streak row plus today's minutes into the shape the UI renders.
   */
  private buildSummary(
    streaks: StreakStatsRow,
    minutesToday: number,
    dailyGoalMinutes: number,
    today: string,
    nextMilestone: PracticeStreakSummaryDto['nextMilestone'],
  ): PracticeStreakSummaryDto {
    const roundedMinutesToday = Math.round(minutesToday * 100) / 100;
    const practicedToday = roundedMinutesToday > 0;
    const streakSecuredToday = roundedMinutesToday >= ACTIVE_DAY_MINUTES;

    let streakEventToday: PracticeStreakSummaryDto['streakEventToday'];
    if (!streakSecuredToday) {
      streakEventToday = 'PENDING';
    } else {
      streakEventToday = streaks.currentStreak > 1 ? 'EXTENDED' : 'STARTED';
    }

    const previousRun =
      streaks.previousRunLength && streaks.previousRunEndedOn
        ? {
            days: streaks.previousRunLength,
            endedOn: streaks.previousRunEndedOn,
            daysSinceEnded: this.wholeDaysBetween(
              streaks.previousRunEndedOn,
              today,
            ),
          }
        : null;

    return {
      businessTimezone: BUSINESS_TIMEZONE,
      today,
      practicedToday,
      streakSecuredToday,
      minutesToday: roundedMinutesToday,
      dailyGoalMinutes,
      minutesToGoal:
        Math.round(Math.max(0, dailyGoalMinutes - roundedMinutesToday) * 100) /
        100,
      atRisk: streaks.currentStreak > 0 && !streakSecuredToday,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
      streakStartDate: streaks.streakStartDate,
      lastActiveDate: streaks.lastActiveDate,
      previousRun,
      nextMilestone,
      streakEventToday,
    };
  }

  /**
   * Streak state without the heatmap cells — skips the generate_series bucket
   * query entirely. This is what high-frequency callers (a persistent nav
   * indicator, the post-session moment) should use.
   */
  async getPracticeStreakSummary(
    userId: number,
    tenantId: string,
  ): Promise<PracticeStreakSummaryDto> {
    const today = toBusinessDateString();

    const [streaks, minutesToday, dailyGoalMinutes] = await Promise.all([
      this.userDailyScoreRepository.getUserStreaks(userId, tenantId, today),
      this.userDailyScoreRepository.getMinutesOnDate(userId, tenantId, today),
      this.resolveDailyGoalMinutes(tenantId),
    ]);

    const nextMilestone =
      await this.badgeStreakMilestoneSharedService.getNextMilestone(
        userId,
        tenantId,
        streaks.currentStreak,
      );

    return this.buildSummary(
      streaks,
      minutesToday,
      dailyGoalMinutes,
      today,
      nextMilestone,
    );
  }

  private toDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  /**
   * Resolves the [from, to] window. `to` defaults to today; when `from` is not
   * supplied it is derived from `groupBy` so the default window shows a
   * reasonable number of cells for the chosen granularity.
   */
  private resolveRange(
    groupBy: PracticeStreakGroupBy,
    from?: string,
    to?: string,
  ): { from: Date; to: Date } {
    const toDate = to
      ? this.toDateOnly(new Date(to))
      : this.toDateOnly(new Date());

    if (from) {
      return { from: this.toDateOnly(new Date(from)), to: toDate };
    }

    const fromDate = new Date(toDate);
    const count = DEFAULT_BUCKET_COUNT[groupBy] - 1; // inclusive of the current bucket
    switch (groupBy) {
      case PracticeStreakGroupBy.WEEK:
        fromDate.setUTCDate(fromDate.getUTCDate() - count * 7);
        break;
      case PracticeStreakGroupBy.MONTH:
        fromDate.setUTCMonth(fromDate.getUTCMonth() - count);
        break;
      case PracticeStreakGroupBy.DAY:
      default:
        fromDate.setUTCDate(fromDate.getUTCDate() - count);
        break;
    }

    return { from: fromDate, to: toDate };
  }

  /**
   * For a bucket start date, returns the inclusive end date of the bucket for
   * the given granularity (used purely for display/tooltip on the client).
   */
  private periodEnd(start: string, groupBy: PracticeStreakGroupBy): string {
    const date = new Date(`${start}T00:00:00.000Z`);
    switch (groupBy) {
      case PracticeStreakGroupBy.WEEK:
        date.setUTCDate(date.getUTCDate() + 6);
        break;
      case PracticeStreakGroupBy.MONTH:
        date.setUTCMonth(date.getUTCMonth() + 1);
        date.setUTCDate(0); // last day of the bucket's month
        break;
      case PracticeStreakGroupBy.DAY:
      default:
        break;
    }
    return date.toISOString().split('T')[0];
  }

  async getPracticeStreak(
    userId: number,
    tenantId: string,
    groupBy: PracticeStreakGroupBy = PracticeStreakGroupBy.DAY,
    from?: string,
    to?: string,
  ): Promise<PracticeStreakResponseDto> {
    const range = this.resolveRange(groupBy, from, to);
    const unit = UNIT_BY_GROUP_BY[groupBy];

    const [buckets, summary] = await Promise.all([
      this.userDailyScoreRepository.getPracticeMinutesByBucket(
        userId,
        tenantId,
        unit,
        range.from,
        range.to,
      ),
      this.getPracticeStreakSummary(userId, tenantId),
    ]);

    const cells: PracticeStreakCell[] = buckets.map((bucket) => ({
      periodStart: bucket.bucket,
      periodEnd: this.periodEnd(bucket.bucket, groupBy),
      minutes: Math.round(bucket.minutes * 100) / 100,
    }));

    const totalMinutes =
      Math.round(cells.reduce((sum, cell) => sum + cell.minutes, 0) * 100) /
      100;

    return {
      ...summary,
      groupBy,
      cells,
      totalMinutes,
    };
  }
}
