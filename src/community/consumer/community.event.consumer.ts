import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { LoggerService } from 'src/logger/logger.service';
import {
  ScenarioSessionLeaderboardEvent,
  ScenarioSessionLeaderboardEndedEventParams,
  LeaderboardActionEvent,
  MinutesPlayedUpdatedEventParams,
} from 'src/learn/type/scenario-session-leaderboard-event.type';

@Injectable()
export class CommunityEventConsumer {
  private readonly logger = LoggerService.getInstance(
    CommunityEventConsumer.name,
  );

  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Reactions and comments on a peer's review used to increment
  // `user_daily_scores.totalScore`. That currency is retired: the leaderboard scores on
  // xp_events now, so those writes fed a number nothing read. Comments are paid as XP
  // instead — see ProgressEventConsumer.handleReviewCommentAdded, which applies a
  // substance floor and a daily cap. Reactions earn nothing at all: they are a single
  // click, and paying for them made the cheapest possible action the most farmable.

  @OnEvent(ScenarioSessionLeaderboardEvent.SCENARIO_SESSION_ENDED, {
    async: true,
  })
  async handleScenarioSessionEnded({
    userId,
    tenantId,
    date,
    durationMinutes,
  }: ScenarioSessionLeaderboardEndedEventParams): Promise<void> {
    try {
      // No pre-read: upsertDailyScore reports the threshold crossing via
      // RETURNING. The old findOne also computed the day in Node-local time,
      // which disagreed with the upsert's business-timezone day.
      const { businessDate, crossedActiveThreshold } =
        await this.userDailyScoreRepository.upsertDailyScore(
          userId,
          tenantId,
          date,
          durationMinutes,
        );
      this.eventEmitter.emit(LeaderboardActionEvent.MINUTES_PLAYED_UPDATED, {
        userId,
        tenantId,
        businessDate,
        crossedActiveThreshold,
      } as MinutesPlayedUpdatedEventParams);
      this.logger.info(`Upserted minutes played score for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to add minutes played for user ${userId}: ${error.message}`,
      );
    }
  }
}
