import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';

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

  async getMaxActiveDaysPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; maxStreak: number }[]> {
    return this.userDailyScoreRepository.getMaxActiveDaysPerUser(
      tenantIds,
      userIds,
    );
  }
}
