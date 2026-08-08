import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BadgeAwardService } from '../service/badge-award.service';
import {
  ReviewCommentAddedEventParams,
  ReviewCommentReactionAddedEventParams,
  ReviewCommentReactionRemovedEventParams,
  ReviewReactionAddedEventParams,
  ReviewReactionRemovedEventParams,
  ScenarioSessionReviewEvents,
  ReviewCommentRemovedEventParams,
} from 'src/review/type/review-event.type';
import {
  LeaderboardActionEvent,
  MinutesPlayedUpdatedEventParams,
} from 'src/learn/type/scenario-session-leaderboard-event.type';
import {
  AuthorizationEvents,
  UserRoleAssignedEventParams,
} from 'src/authorization/type/authorization-event.type';

@Injectable()
export class BadgeEventConsumer {
  constructor(private readonly badgeAwardService: BadgeAwardService) {}

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_ADDED, { async: true })
  async handleAddReviewComment({
    review,
    comment,
  }: ReviewCommentAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      review.createdBy,
      comment.createdBy,
    );
  }

  @OnEvent(ScenarioSessionReviewEvents.REACTION_ADDED, { async: true })
  async handleAddReviewReaction({
    review,
    reaction,
  }: ReviewReactionAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      review.createdBy,
      reaction.createdBy,
    );
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REACTION_ADDED, { async: true })
  async handleAddReviewCommentReaction({
    reaction,
    review,
  }: ReviewCommentReactionAddedEventParams) {
    await this.badgeAwardService.awardCommentReactionBadgeByReceiverGiverId(
      review.createdBy,
      reaction.createdBy,
    );
  }

  @OnEvent(ScenarioSessionReviewEvents.REACTION_REMOVED, { async: true })
  async handleRemoveReviewReaction({
    review,
    removedReaction,
  }: ReviewReactionRemovedEventParams) {
    await this.badgeAwardService.revokeInvalidReactionBadgesByReceiverGiverId(
      review.createdBy,
      removedReaction.createdBy,
    );
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REACTION_REMOVED, {
    async: true,
  })
  async handleRemoveReviewCommentReaction({
    removedReaction,
    review,
  }: ReviewCommentReactionRemovedEventParams) {
    await this.badgeAwardService.revokeInvalidReactionBadgesByReceiverGiverId(
      review.createdBy,
      removedReaction.createdBy,
    );
  }

  @OnEvent(ScenarioSessionReviewEvents.COMMENT_REMOVED, { async: true })
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
    tenantId,
    crossedActiveThreshold,
  }: MinutesPlayedUpdatedEventParams) {
    // Award simulation minutes badges for user
    await this.badgeAwardService.awardSimulationMinutesBadgeByUserId(userId);

    // Evaluate streak badges only when THIS write pushed the day across the
    // 1.00-minute active-day line. A day can only cross once, so this fires
    // exactly once per active day — the optimisation the old guard intended.
    //
    // The old guard ("skip if a row already existed") was wrong: a sub-1-minute
    // first session of the day creates a row without making the day active, so
    // every later session that day returned early and the streak badge was
    // never awarded.
    if (!crossedActiveThreshold) return;
    await this.badgeAwardService.awardActiveDayStreakBadgeByUserId(
      userId,
      tenantId,
    );
  }

  @OnEvent(AuthorizationEvents.USER_ROLE_ASSIGNED, { async: true })
  async handleUserRoleAssigned({
    userId,
    groupId,
    tenantId,
  }: UserRoleAssignedEventParams) {
    await this.badgeAwardService.awardBadgesForUserRole(
      userId,
      groupId,
      tenantId,
    );
  }
}
