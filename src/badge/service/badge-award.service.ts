import { Injectable } from '@nestjs/common';

import { BadgeUserService } from './badge-user.service';
import { BadgeService } from './badge.service';
import { BadgeCategory } from '../constants/badge.constants';

@Injectable()
export class BadgeAwardService {
  constructor(
    private readonly badgeService: BadgeService,
    private readonly badgeUserService: BadgeUserService,
  ) {}

  async awardCommentReactionBadgeByReceiverGiverId(
    receiverId: number,
    giverId: number,
  ) {
    // No badges will be awarded for given and received id if the giver and receiver is same
    if (receiverId === giverId) return;

    const availableUnawardedBadges =
      await this.badgeService.getAvailableUnawardedBadges(receiverId);

    if (!availableUnawardedBadges || availableUnawardedBadges?.length === 0)
      return;

    // Award badge to the receiver for comments/reactions received
    const availableUnawardedBadgesForCommentsReactionsReceived =
      availableUnawardedBadges.filter(
        (badge) => badge.category === BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
      );
    if (availableUnawardedBadgesForCommentsReactionsReceived?.length > 0) {
      const receivedCommentsReactionsCountMap =
        await this.badgeUserService.getReceivedCommentsOrReactionsCount(
          undefined,
          [receiverId],
        );

      const receivedCommentsReactionsCount =
        receivedCommentsReactionsCountMap.find(
          (item) => item.userId === receiverId,
        )?.count ?? 0;

      const badgeToAward = availableUnawardedBadgesForCommentsReactionsReceived
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
        await this.badgeUserService.saveBadgeUsers(badgeToAward);
      }
    }

    // award badges to the giver for comments/reactions given
    const availableUnawardedBadgesForCommentsReactionsGiven =
      availableUnawardedBadges.filter(
        (badge) => badge.category === BadgeCategory.COMMENTS_REACTIONS_GIVEN,
      );
    if (availableUnawardedBadgesForCommentsReactionsGiven?.length > 0) {
      const givenCommentsReactionsCountMap =
        await this.badgeUserService.getGivenCommentsOrReactionsCount(
          undefined,
          [giverId],
        );
      const givenCommentsReactionsCount =
        givenCommentsReactionsCountMap.find((item) => item.userId === giverId)
          ?.count ?? 0;

      const badgeToAward = availableUnawardedBadgesForCommentsReactionsGiven
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
        await this.badgeUserService.saveBadgeUsers(badgeToAward);
      }
    }
  }

  async revokeInvalidReactionBadgesByReceiverGiverId(
    receiverId: number,
    giverId: number,
  ) {
    // No badges will be revoked for given and received id if the giver and receiver is same
    if (receiverId === giverId) return;

    // Revalidate the received comments/reactions awarded badges when a reaction is removed
    const receiverUserBadges =
      await this.badgeService.getUserBadges(receiverId);
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
        await this.badgeUserService.deleteUserBadges(
          receiverId,
          invalidBadges.map((badge) => badge.id),
        );
      }
    }

    // Revalidate the given comments/reactions awarded badges when a reaction is removed
    const giverUserBadges = await this.badgeService.getUserBadges(giverId);

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
        await this.badgeUserService.deleteUserBadges(
          giverId,
          invalidBadges.map((badge) => badge.id),
        );
      }
    }
  }
}
