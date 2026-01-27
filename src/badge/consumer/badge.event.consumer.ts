import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BadgeAwardService } from '../service/badge-award.service';
import {
  ReviewCommentAddedEventParams,
  ReviewCommentReactionAddedEventParams,
  ReviewCommentReactionRemovedEventParams,
  ReviewReactionAddedEventParams,
  ReviewReactionRemovedEventParams,
  ReviewEvents,
  ReviewCommentRemovedEventParams,
} from 'src/review/type/review-event.type';
import {
  LeaderboardActionEvent,
  MinutesPlayedUpdatedEventParams,
} from 'src/learn/type/scenario-session-leaderboard-event.type';

@Injectable()
export class BadgeEventConsumer {
  constructor(private readonly badgeAwardService: BadgeAwardService) {}

  @OnEvent(ReviewEvents.REVIEW_COMMENT_ADDED, { async: true })
  async handleAddReviewComment({
    review,
    comment,
  }: ReviewCommentAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      review.createdBy,
      comment.createdBy,
    );
  }

  @OnEvent(ReviewEvents.REVIEW_REACTION_ADDED, { async: true })
  async handleAddReviewReaction({
    review,
    reaction,
  }: ReviewReactionAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      review.createdBy,
      reaction.createdBy,
    );
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REACTION_ADDED, { async: true })
  async handleAddReviewCommentReaction({
    reaction,
    comment,
  }: ReviewCommentReactionAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      comment.createdBy,
      reaction.createdBy,
    );
  }

  @OnEvent(ReviewEvents.REVIEW_REACTION_REMOVED, { async: true })
  async handleRemoveReviewReaction({
    review,
    removedReaction,
  }: ReviewReactionRemovedEventParams) {
    await this.badgeAwardService.revokeInvalidReactionBadgesByReceiverGiverId(
      review.createdBy,
      removedReaction.createdBy,
    );
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REACTION_REMOVED, { async: true })
  async handleRemoveReviewCommentReaction({
    comment,
    removedReaction,
  }: ReviewCommentReactionRemovedEventParams) {
    await this.badgeAwardService.revokeInvalidReactionBadgesByReceiverGiverId(
      comment.createdBy,
      removedReaction.createdBy,
    );
  }

  @OnEvent(ReviewEvents.REVIEW_COMMENT_REMOVED, { async: true })
  async handleReviewCommentRemoved(
    reviewCommentReactionEventParams: ReviewCommentRemovedEventParams,
  ) {
    await this.badgeAwardService.revokeInvalidBadgesOnCommentDeletion(
      reviewCommentReactionEventParams,
    );
  }

  @OnEvent(LeaderboardActionEvent.MINUTES_PLAYED_UPDATED, { async: true })
  async handleMinutesPlayedUpdated({
    userId,
    userDateEntryBeforeUpdation,
  }: MinutesPlayedUpdatedEventParams) {
    // Award simulation minutes badges for user
    await this.badgeAwardService.awardSimulationMinutesBadgeByUserId(userId);

    // Skip active day streak badge award if a user-date entry already exists.
    // This indicates the active day streak was already calculated for this date,
    // so no new badges calculation should be done to optimize queries.
    if (userDateEntryBeforeUpdation?.id) return;
    await this.badgeAwardService.awardActiveDayStreakBadgeByUserId(userId);
  }
}
