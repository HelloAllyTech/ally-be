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
}
