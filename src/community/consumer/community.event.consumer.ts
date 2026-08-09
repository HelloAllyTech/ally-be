import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { UserDailyScoreRepository } from '../repository/user-daily-score.repository';
import { scorePoints } from '../constant/community.constant';
import { LoggerService } from 'src/logger/logger.service';
import {
  ScenarioSessionReviewEvents,
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

  @OnEvent(ScenarioSessionReviewEvents.REACTION_ADDED, { async: true })
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
      this.logger.info(
        `Incremented reaction score for user ${reaction.createdBy} for review ${review.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment reaction score for user ${reaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ScenarioSessionReviewEvents.REACTION_REMOVED, { async: true })
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
      this.logger.info(
        `Decremented reaction score for user ${removedReaction.createdBy} for review ${review.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement reaction score for user ${removedReaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_ADDED, { async: true })
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
      this.logger.info(
        `Incremented comment score for user ${comment.createdBy} for review ${review.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment comment score for user ${comment.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REMOVED, { async: true })
  async handleReviewCommentRemoved({
    review,
    comment,
    commentReplies,
    commentReactions,
    commentReplyReactions,
  }: ReviewCommentRemovedEventParams): Promise<void> {
    if (review.createdBy === comment.createdBy) {
      return;
    }

    try {
      await this.dataSource.transaction(
        async (entityManager: EntityManager) => {
          await this.userDailyScoreRepository.decrementTotalScore(
            comment.createdBy,
            comment.tenantId,
            scorePoints.COMMENT,
            entityManager,
          );

          if (commentReplies && commentReplies?.length > 0) {
            for (const reply of commentReplies) {
              await this.userDailyScoreRepository.decrementTotalScore(
                reply.createdBy,
                reply.tenantId,
                scorePoints.COMMENT,
                entityManager,
              );
            }
          }

          if (commentReactions && commentReactions?.length > 0) {
            for (const reaction of commentReactions) {
              await this.userDailyScoreRepository.decrementTotalScore(
                reaction.createdBy,
                reaction.tenantId,
                scorePoints.REACTION,
                entityManager,
              );
            }
          }

          if (commentReplyReactions && commentReplyReactions?.length > 0) {
            for (const reaction of commentReplyReactions) {
              await this.userDailyScoreRepository.decrementTotalScore(
                reaction.createdBy,
                reaction.tenantId,
                scorePoints.REACTION,
                entityManager,
              );
            }
          }
        },
      );
      this.logger.info(
        `Decremented comment score for user ${comment.createdBy} for review ${review.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to decrement comment score for user ${comment.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REACTION_ADDED, { async: true })
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
      this.logger.info(
        `Incremented comment reaction score for user ${reaction.createdBy} for review ${comment.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to increment comment reaction score for user ${reaction.createdBy}: ${error.message}`,
      );
    }
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REACTION_REMOVED, {
    async: true,
  })
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
      this.logger.info(
        `Decremented comment reaction score for user ${removedReaction.createdBy} for review ${comment.id}`,
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
