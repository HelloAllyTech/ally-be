import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { StreakStatsRow } from '../type/practice-streak.type';
import { toBusinessDateString } from 'src/common/util/date.util';

@Injectable()
export class CommunitySharedService {
  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
  ) {}

  async getTotalSimulationMinutesPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; totalMinutes: number }[]> {
    return this.userDailyScoreRepository.getTotalSimulationMinutesPerUser(
      tenantIds,
      userIds,
    );
  }

  /**
   * Streak statistics for one user in one tenant.
   */
  async getStreakStatsForUser(
    userId: number,
    tenantId: string,
    businessToday: string = toBusinessDateString(),
  ): Promise<StreakStatsRow> {
    return this.userDailyScoreRepository.getUserStreaks(
      userId,
      tenantId,
      businessToday,
    );
  }

  /**
   * Longest consecutive-active-days run per user, for badge threshold checks.
   *
   * Streaks are tenant-scoped, so this runs one tenant at a time and collapses
   * to the best run per user. Passing every tenant's rows through a single
   * un-scoped query (as this used to) duplicates a multi-tenant user's calendar
   * days, which splits their islands and understates the streak — a genuine
   * six-day run reported as two.
   */
  async getMaxActiveDaysPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; maxStreak: number }[]> {
    if (!tenantIds?.length) {
      return [];
    }

    const businessToday = toBusinessDateString();
    const bestByUser = new Map<number, number>();

    for (const tenantId of tenantIds) {
      const rows = await this.userDailyScoreRepository.getStreakStatsForUsers(
        tenantId,
        userIds,
        businessToday,
      );
      for (const row of rows) {
        const best = bestByUser.get(row.userId) ?? 0;
        if (row.longestStreak > best) {
          bestByUser.set(row.userId, row.longestStreak);
        }
      }
    }

    return Array.from(bestByUser, ([userId, maxStreak]) => ({
      userId,
      maxStreak,
    }));
  }
}
