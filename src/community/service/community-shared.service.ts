import { Injectable } from '@nestjs/common';
import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { LoggerService } from 'src/logger/logger.service';
import { scorePoints } from '../constant/community.constant';

@Injectable()
export class CommunitySharedService {
  private readonly logger = LoggerService.getInstance(
    CommunitySharedService.name,
  );

  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
  ) {}

  async addMinutesPlayed(
    userId: number,
    tenantId: string,
    minutes: number,
  ): Promise<void> {
    try {
      await this.userDailyScoreRepository.upsertDailyScore(
        userId,
        tenantId,
        new Date(),
        scorePoints.MINUTES_PLAYED * minutes,
      );
    } catch (error) {
      this.logger.error(
        `Failed to add minutes played for user ${userId}: ${error.message}`,
      );
    }
  }

  async incrementReactionScore(
    userId: number,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.userDailyScoreRepository.incrementTotalScore(
        userId,
        tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment reaction score for user ${userId}: ${error.message}`,
      );
    }
  }

  async decrementReactionScore(
    userId: number,
    tenantId: string,
  ): Promise<void> {
    try {
      await this.userDailyScoreRepository.decrementTotalScore(
        userId,
        tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement reaction score for user ${userId}: ${error.message}`,
      );
    }
  }

  async incrementCommentScore(userId: number, tenantId: string): Promise<void> {
    try {
      await this.userDailyScoreRepository.incrementTotalScore(
        userId,
        tenantId,
        scorePoints.COMMENT,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment comment score for user ${userId}: ${error.message}`,
      );
    }
  }

  async decrementCommentScore(userId: number, tenantId: string): Promise<void> {
    try {
      await this.userDailyScoreRepository.decrementTotalScore(
        userId,
        tenantId,
        scorePoints.COMMENT,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement comment score for user ${userId}: ${error.message}`,
      );
    }
  }

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
