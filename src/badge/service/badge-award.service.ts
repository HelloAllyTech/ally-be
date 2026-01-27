import { Injectable, Logger } from '@nestjs/common';

import { BadgeUserService } from './badge-user.service';
import { BadgeService } from './badge.service';
import { BadgeCategory } from '../constants/badge.constants';

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
  ) {
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
  ) {
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

  async revokeInvalideBadgesOnCommentDeletion({
    review,
    comment,
  }: ReviewCommentRemovedEventParams) {
    if (!review || !comment) return;
  }
}
