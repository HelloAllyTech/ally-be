import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { scorePoints } from '../constant/community.constant';
import { LoggerService } from 'src/logger/logger.service';
import {
  ReviewEvents,
  ReviewReactionAddedEventParams,
  ReviewReactionRemovedEventParams,
  ReviewCommentAddedEventParams,
  ReviewCommentRemovedEventParams,
  ReviewCommentReactionAddedEventParams,
  ReviewCommentReactionRemovedEventParams,
} from 'src/review/type/review-event.type';
import {
  ScenarioSessionLeaderboardEvent,
  ScenarioSessionLeaderboardEndedEventParams,
} from 'src/learn/type/scenario-session-leaderboard-event.type';

@Injectable()
export class CommunityEventConsumer {
  private readonly logger = LoggerService.getInstance(
    CommunityEventConsumer.name,
  );

  constructor(
    private readonly userDailyScoreRepository: UserDailyScoreRepository,
  ) {}

  @OnEvent(ReviewEvents.REVIEW_REACTION_ADDED, { async: true })
  async handleReviewReactionAdded({
    review,
    reaction,
  }: ReviewReactionAddedEventParams): Promise<void> {
    if (review.createdBy === reaction.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.incrementTotalScore(
        reaction.createdBy,
        reaction.tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment reaction score for user ${reaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ReviewEvents.REVIEW_REACTION_REMOVED, { async: true })
  async handleReviewReactionRemoved({
    review,
    removedReaction,
  }: ReviewReactionRemovedEventParams): Promise<void> {
    if (review.createdBy === removedReaction.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.decrementTotalScore(
        removedReaction.createdBy,
        removedReaction.tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement reaction score for user ${removedReaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_ADDED, { async: true })
  async handleReviewCommentAdded({
    review,
    comment,
  }: ReviewCommentAddedEventParams): Promise<void> {
    if (review.createdBy === comment.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.incrementTotalScore(
        comment.createdBy,
        comment.tenantId,
        scorePoints.COMMENT,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment comment score for user ${comment.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REMOVED, { async: true })
  async handleReviewCommentRemoved({
    review,
    comment,
  }: ReviewCommentRemovedEventParams): Promise<void> {
    if (review.createdBy === comment.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.decrementTotalScore(
        comment.createdBy,
        comment.tenantId,
        scorePoints.COMMENT,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement comment score for user ${comment.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REACTION_ADDED, { async: true })
  async handleReviewCommentReactionAdded({
    reaction,
    comment,
  }: ReviewCommentReactionAddedEventParams): Promise<void> {
    if (comment.createdBy === reaction.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.incrementTotalScore(
        reaction.createdBy,
        reaction.tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment comment reaction score for user ${reaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REACTION_REMOVED, { async: true })
  async handleReviewCommentReactionRemoved({
    removedReaction,
    comment,
  }: ReviewCommentReactionRemovedEventParams): Promise<void> {
    if (comment.createdBy === removedReaction.createdBy) {
      return;
    }

    try {
      await this.userDailyScoreRepository.decrementTotalScore(
        removedReaction.createdBy,
        removedReaction.tenantId,
        scorePoints.REACTION,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement comment reaction score for user ${removedReaction.createdBy}: ${error.message}`,
      );
    }
  }

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
      await this.userDailyScoreRepository.upsertDailyScore(
        userId,
        tenantId,
        date,
        durationMinutes,
      );
    } catch (error) {
      this.logger.error(
        `Failed to add minutes played for user ${userId}: ${error.message}`,
      );
    }
  }
}
