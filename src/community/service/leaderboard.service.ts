import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import {
  LeaderboardResponseDto,
  MyRankResponseDto,
} from '../dto/leaderboard.dto';
import { LeaderboardView } from '../type/leaderboard.type';
import { Pagination } from 'src/common/type/common.type';

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
  ) {}

  private getDateRange(window: LeaderboardView): {
    startDate: Date;
    endDate: Date;
  } {
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    let startDate: Date;

    switch (window) {
      case LeaderboardView.LAST_WEEK:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 6); // Last 7 days including today
        break;
      case LeaderboardView.LAST_MONTH:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 27); // Last 28 days including today
        break;
      case LeaderboardView.LAST_YEAR:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 363); // Last 364 days including today
        break;
      case LeaderboardView.ALL_TIME:
        startDate = new Date('2020-01-01'); // A date far enough in the past
        break;
    }

    startDate.setHours(0, 0, 0, 0);
    return { startDate, endDate };
  }

  async getLeaderboard(
    tenantId: string,
    window: LeaderboardView,
    pagination?: Pagination,
  ): Promise<LeaderboardResponseDto> {
    const { startDate, endDate } = this.getDateRange(window);

    const { data, totalCount } =
      await this.userDailyScoreRepository.getLeaderboardWithUserDetails(
        tenantId,
        startDate,
        endDate,
        pagination,
      );

    return {
      data,
      window,
      totalCount,
    };
  }

  async getMyRank(
    userId: number,
    tenantId: string,
    window: LeaderboardView,
  ): Promise<MyRankResponseDto> {
    const { startDate, endDate } = this.getDateRange(window);

    const rankResult =
      await this.userDailyScoreRepository.getUserRankWithDetails(
        userId,
        tenantId,
        startDate,
        endDate,
      );

    if (rankResult) {
      return {
        ...rankResult,
        window,
      };
    }

    // User has no activity in this window - get their details anyway
    const userDetails =
      await this.userDailyScoreRepository.getUserDetailsForNoActivity(userId);

    return {
      userId,
      name: userDetails.name,
      profileImageUrl: userDetails.profileImageUrl,
      rank: 0, // 0 indicates no rank (no activity)
      minutesPlayed: 0,
      badgeCount: userDetails.badgeCount,
      window,
    };
  }
}
