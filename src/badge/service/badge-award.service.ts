import { Injectable, Logger } from '@nestjs/common';

import { BadgeUserService } from './badge-user.service';
import { BadgeService } from './badge.service';
import { BadgeCategory } from '../constants/badge.constants';
import { filterInvalidBadges } from '../util/badge.util';

import { ReviewCommentRemovedEventParams } from 'src/review/type/review-event.type';

@Injectable()
export class BadgeAwardService {
  private readonly logger = new Logger(BadgeAwardService.name);

  constructor(
    private readonly badgeService: BadgeService,
    private readonly badgeUserService: BadgeUserService,
  ) {}

  async awardCommentReactionBadgeByReceiverGiverId(
    receiverId: number,
    giverId: number,
  ): Promise<void> {
    this.logger.log(
      `Processing badge award for receiverId=${receiverId}, giverId=${giverId}`,
    );

    // No badges will be awarded for given and received id if the giver and receiver is same
    if (receiverId === giverId) return;

    // Fetch unawarded badges separately for receiver and giver
    const [receiverUnawardedBadges, giverUnawardedBadges] = await Promise.all([
      this.badgeService.getAvailableUnawardedBadges(
        receiverId,
        BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
      ),
      this.badgeService.getAvailableUnawardedBadges(
        giverId,
        BadgeCategory.COMMENTS_REACTIONS_GIVEN,
      ),
    ]);

    // Award badge to the receiver for comments/reactions received
    if (receiverUnawardedBadges?.length > 0) {
      const receivedCommentsReactionsCountMap =
        await this.badgeUserService.getReceivedCommentsOrReactionsCount(
          undefined,
          [receiverId],
        );

      const receivedCommentsReactionsCount =
        receivedCommentsReactionsCountMap.find(
          (item) => item.userId === receiverId,
        )?.count ?? 0;

      const badgeToAward = receiverUnawardedBadges
        .filter(
          (badge) =>
            badge.achievementParams?.count &&
            badge.achievementParams?.count <= receivedCommentsReactionsCount,
        )
        ?.map((badge) => ({
          userId: receiverId,
          badgeId: badge.id,
        }));
      if (badgeToAward.length > 0) {
        try {
          await this.badgeUserService.saveBadgeUsers(badgeToAward);
          this.logger.log(
            `Awarded ${badgeToAward.length} badge(s) to receiver userId=${receiverId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to award badge(s) to receiver userId=${receiverId}`,
            error.stack,
          );
        }
      }
    }

    // Award badges to the giver for comments/reactions given
    if (giverUnawardedBadges?.length > 0) {
      const givenCommentsReactionsCountMap =
        await this.badgeUserService.getGivenCommentsOrReactionsCount(
          undefined,
          [giverId],
        );
      const givenCommentsReactionsCount =
        givenCommentsReactionsCountMap.find((item) => item.userId === giverId)
          ?.count ?? 0;

      const badgeToAward = giverUnawardedBadges
        .filter(
          (badge) =>
            badge.achievementParams?.count &&
            badge.achievementParams?.count <= givenCommentsReactionsCount,
        )
        ?.map((badge) => ({
          userId: giverId,
          badgeId: badge.id,
        }));
      if (badgeToAward.length > 0) {
        try {
          await this.badgeUserService.saveBadgeUsers(badgeToAward);
          this.logger.log(
            `Awarded ${badgeToAward.length} badge(s) to giver userId=${giverId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to award badge(s) to giver userId=${giverId}`,
            error.stack,
          );
        }
      }
    }
  }

  async revokeInvalidReactionBadgesByReceiverGiverId(
    receiverId: number,
    giverId: number,
  ): Promise<void> {
    this.logger.log(
      `Processing badge revocation for receiverId=${receiverId}, giverId=${giverId}`,
    );

    // No badges will be revoked for given and received id if the giver and receiver is same
    if (receiverId === giverId) return;

    // Fetch badges for both users in parallel
    const [receiverUserBadges, giverUserBadges] = await Promise.all([
      this.badgeService.getUserBadges(receiverId),
      this.badgeService.getUserBadges(giverId),
    ]);

    // Revalidate the received comments/reactions awarded badges when a reaction is removed
    const userCommentsReactionsReceivedBadges =
      receiverUserBadges?.data?.filter(
        (badge) => badge.category === BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
      );
    if (userCommentsReactionsReceivedBadges?.length > 0) {
      const receivedCommentsReactionsCountMap =
        await this.badgeUserService.getReceivedCommentsOrReactionsCount(
          undefined,
          [receiverId],
        );
      const receivedCommentsReactionsCount =
        receivedCommentsReactionsCountMap.find(
          (item) => item.userId === receiverId,
        )?.count ?? 0;

      const invalidBadges = userCommentsReactionsReceivedBadges.filter(
        (badge) =>
          badge.achievementParams?.count &&
          badge.achievementParams?.count > receivedCommentsReactionsCount,
      );
      if (invalidBadges.length > 0) {
        try {
          await this.badgeUserService.deleteUserBadges(
            receiverId,
            invalidBadges.map((badge) => badge.id),
          );
          this.logger.log(
            `Revoked ${invalidBadges.length} badge(s) from receiver userId=${receiverId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to revoke badge(s) from receiver userId=${receiverId}`,
            error.stack,
          );
        }
      }
    }

    // Revalidate the given comments/reactions awarded badges when a reaction is removed
    const giverCommentsReactionsGivenBadges = giverUserBadges?.data?.filter(
      (badge) => badge.category === BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    );
    if (giverCommentsReactionsGivenBadges?.length > 0) {
      const giverCommentsReactionsCountMap =
        await this.badgeUserService.getGivenCommentsOrReactionsCount(
          undefined,
          [giverId],
        );
      const giverCommentsReactionsCount =
        giverCommentsReactionsCountMap.find((item) => item.userId === giverId)
          ?.count ?? 0;

      const invalidBadges = giverCommentsReactionsGivenBadges.filter(
        (badge) =>
          badge.achievementParams?.count &&
          badge.achievementParams?.count > giverCommentsReactionsCount,
      );
      if (invalidBadges.length > 0) {
        try {
          await this.badgeUserService.deleteUserBadges(
            giverId,
            invalidBadges.map((badge) => badge.id),
          );
          this.logger.log(
            `Revoked ${invalidBadges.length} badge(s) from giver userId=${giverId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to revoke badge(s) from giver userId=${giverId}`,
            error.stack,
          );
        }
      }
    }
  }

  private getRevokeInvalidReceiverGiverUserIdList({
    review,
    comment,
    commentReactions,
    commentReplies,
    commentReplyReactions,
  }: ReviewCommentRemovedEventParams) {
    const giverRecheckList: number[] = [];
    const receiverRecheckList: number[] = [];
    if (comment.createdBy !== review.createdBy) {
      giverRecheckList.push(comment.createdBy);
      receiverRecheckList.push(review.createdBy);
    }

    // Find comment reactions not given by the comment owner.
    // Add reaction creators to the giver list and the comment owner to the receiver list.
    const commentReactionsNotGivenByCommentOwner = commentReactions?.filter(
      (reaction) => reaction.createdBy !== comment.createdBy,
    );
    if (
      commentReactionsNotGivenByCommentOwner &&
      commentReactionsNotGivenByCommentOwner?.length > 0
    ) {
      giverRecheckList.push(
        ...commentReactionsNotGivenByCommentOwner.map(
          (reaction) => reaction.createdBy,
        ),
      );
      receiverRecheckList.push(comment.createdBy);
    }

    if (!commentReplies?.length)
      return { receiverRecheckList, giverRecheckList };

    // Find comment replies not given by the comment owner.
    // Add reply creators to the giver list and the comment owner to the receiver list.
    const commentRepliesNotGivenByCommentOwner = commentReplies?.filter(
      (reply) => reply.createdBy !== comment.createdBy,
    );
    if (
      commentRepliesNotGivenByCommentOwner &&
      commentRepliesNotGivenByCommentOwner?.length > 0
    ) {
      giverRecheckList.push(
        ...commentRepliesNotGivenByCommentOwner.map((reply) => reply.createdBy),
      );
      receiverRecheckList.push(comment.createdBy);
    }

    if (!commentReplyReactions?.length)
      return { receiverRecheckList, giverRecheckList };

    // Find comment reply reactions not given by the reply owner.
    // Add reaction creators to the giver list and reply owners to the receiver list.
    const commentReplyReactionNotGivenByOwner = commentReplyReactions?.filter(
      (replyReaction) => {
        const reply = commentReplies?.find(
          (reply) => reply.id === replyReaction.reviewCommentId,
        );
        return reply && reply.createdBy !== replyReaction.createdBy;
      },
    );
    if (
      commentReplyReactionNotGivenByOwner &&
      commentReplyReactionNotGivenByOwner?.length > 0
    ) {
      giverRecheckList.push(
        ...commentReplyReactionNotGivenByOwner.map(
          (replyReaction) => replyReaction.createdBy,
        ),
      );
      const reactionReplyOwner = commentReplyReactionNotGivenByOwner
        .map((replyReaction) => {
          const reply = commentReplies?.find(
            (reply) => reply.id === replyReaction.reviewCommentId,
          );
          return reply?.createdBy;
        })
        .filter((id): id is number => id !== undefined);
      receiverRecheckList.push(...reactionReplyOwner);
    }

    return { receiverRecheckList, giverRecheckList };
  }

  async revokeInvalidBadgesOnCommentDeletion({
    review,
    comment,
    commentReactions,
    commentReplies,
    commentReplyReactions,
  }: ReviewCommentRemovedEventParams) {
    if (!review || !comment) return;

    const { receiverRecheckList, giverRecheckList } =
      this.getRevokeInvalidReceiverGiverUserIdList({
        review,
        comment,
        commentReactions,
        commentReplies,
        commentReplyReactions,
      });

    const totalList = [
      ...new Set([...giverRecheckList, ...receiverRecheckList]),
    ];

    // Validate and identify badges that need to be revoked.
    // For receivers: check if their COMMENTS_REACTIONS_RECEIVED badges are still valid.
    // For givers: check if their COMMENTS_REACTIONS_GIVEN badges are still valid.
    // Delete badges where the achievement count exceeds the current actual count.
    const receiverGiverBadges =
      await this.badgeService.getBadgesByUserIdList(totalList);
    const receiverBadgesWithCommentReactionCategory =
      receiverGiverBadges?.filter(
        (badge) =>
          badge.category === BadgeCategory.COMMENTS_REACTIONS_RECEIVED &&
          receiverRecheckList?.some((id) => id === badge.userId),
      );
    const receiverUserIdsWithCommentReactionCategory = [
      ...new Set(
        receiverBadgesWithCommentReactionCategory?.map((badge) => badge.userId),
      ),
    ];
    const receiverCommentReactionsCountMap =
      await this.badgeUserService.getReceivedCommentsOrReactionsCount(
        undefined,
        receiverUserIdsWithCommentReactionCategory,
      );
    const receiverUserBadgesToDelete = filterInvalidBadges(
      receiverBadgesWithCommentReactionCategory,
      receiverCommentReactionsCountMap,
    );

    const giverBadgesWithCommentReactionCategory = receiverGiverBadges?.filter(
      (badge) =>
        badge.category === BadgeCategory.COMMENTS_REACTIONS_GIVEN &&
        giverRecheckList?.some((id) => id === badge.userId),
    );
    const giverUserIdsWithCommentReactionCategory = [
      ...new Set(
        giverBadgesWithCommentReactionCategory?.map((badge) => badge.userId),
      ),
    ];
    const giverCommentReactionsCountMap =
      await this.badgeUserService.getGivenCommentsOrReactionsCount(
        undefined,
        giverUserIdsWithCommentReactionCategory,
      );

    const giverUserBadgesToDelete = filterInvalidBadges(
      giverBadgesWithCommentReactionCategory,
      giverCommentReactionsCountMap,
    );

    const userBadgesToDelete = [
      ...receiverUserBadgesToDelete,
      ...giverUserBadgesToDelete,
    ];
    if (userBadgesToDelete?.length > 0) {
      await this.badgeUserService.deleteUserBadgeList(
        userBadgesToDelete.map((badge) => badge.id),
      );
    }
  }

  async awardSimulationMinutesBadgeByUserId(userId: number): Promise<void> {
    try {
      const simulationMinutes =
        await this.badgeUserService.getSimulationMinutesByUserId(userId);
      if (!simulationMinutes) return;

      const unawardedAvailableSimulationMinutesBadges =
        await this.badgeService.getAvailableUnawardedBadges(
          userId,
          BadgeCategory.SIMULATION_MINUTES,
        );

      const badgesToAward = unawardedAvailableSimulationMinutesBadges.filter(
        (badge) => {
          return (
            badge.achievementParams?.count &&
            badge.achievementParams?.count <= simulationMinutes
          );
        },
      );
      if (badgesToAward.length === 0) return;

      await this.badgeUserService.saveBadgeUsers(
        badgesToAward.map((badge) => ({ badgeId: badge.id, userId })),
      );

      this.logger.log(
        `Awarded ${badgesToAward.length} simulation minutes badge(s) to user id=${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to award simulation minutes badge to user id=${userId}`,
        error.stack,
      );
    }
  }

  async awardActiveDayStreakBadgeByUserId(userId: number): Promise<void> {
    try {
      const activeDayStreak =
        await this.badgeUserService.getMaxActiveDayStreakByUserId(userId);
      if (!activeDayStreak) return;

      const unawardedAvailableActiveDayStreakBadges =
        await this.badgeService.getAvailableUnawardedBadges(
          userId,
          BadgeCategory.ACTIVE_DAY_STREAK,
        );
      const badgesToAward = unawardedAvailableActiveDayStreakBadges?.filter(
        (badge) => {
          return (
            badge.achievementParams?.count &&
            badge.achievementParams?.count <= activeDayStreak
          );
        },
      );
      if (badgesToAward?.length === 0) return;

      await this.badgeUserService.saveBadgeUsers(
        badgesToAward.map((badge) => ({ badgeId: badge.id, userId })),
      );

      this.logger.log(
        `Awarded ${badgesToAward?.length} active day streak badge(s) to user id=${userId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to award active day streak badge to user id=${userId}`,
        error.stack,
      );
    }
  }
}
