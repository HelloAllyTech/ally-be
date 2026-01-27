import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

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
      const userDateEntryBeforeUpdation =
        await this.userDailyScoreRepository.findOne({
          where: {
            userId,
            tenantId,
            date,
          },
        });
      await this.userDailyScoreRepository.upsertDailyScore(
        userId,
        tenantId,
        date,
        durationMinutes,
      );
      this.eventEmitter.emit(LeaderboardActionEvent.MINUTES_PLAYED_UPDATED, {
        userId,
        userDateEntryBeforeUpdation,
      } as MinutesPlayedUpdatedEventParams);
    } catch (error) {
      this.logger.error(
        `Failed to add minutes played for user ${userId}: ${error.message}`,
      );
    }
  }
}
