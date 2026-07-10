import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { PracticeStreakResponseDto } from '../dto/practice-streak.dto';
import {
  PracticeStreakCell,
  PracticeStreakGroupBy,
} from '../type/practice-streak.type';

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
  ) {}

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

    const [buckets, streaks] = await Promise.all([
      this.userDailyScoreRepository.getPracticeMinutesByBucket(
        userId,
        tenantId,
        unit,
        range.from,
        range.to,
      ),
      this.userDailyScoreRepository.getUserStreaks(userId, tenantId),
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
      groupBy,
      cells,
      totalMinutes,
      currentStreak: streaks.currentStreak,
      longestStreak: streaks.longestStreak,
    };
  }
}
