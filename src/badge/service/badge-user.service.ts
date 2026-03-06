import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { BadgeUserRepository } from '../repository/badge-user.repository';
import { Badge } from '../entity/badge.entity';
import { BadgeCategory } from '../constants/badge.constants';
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { UserValueCount } from '../type/badge.type';
import { SaveBadgeUsersRequest } from '../type/badge-response.type';
import { BadgeUser } from '../entity/badge-user.entity';

@Injectable()
export class BadgeUserService {
  private readonly logger = new Logger(BadgeUserService.name);

  constructor(
    private readonly badgeUserRepository: BadgeUserRepository,
    private readonly communitySharedService: CommunitySharedService,
    private readonly scenarioSessionReviewSharedService: ScenarioSessionReviewSharedService,
  ) {}

  async awardBadgeToUsersByTenant(
    badge: Badge,
    tenantIds: string[],
    userIds?: number[],
  ): Promise<void> {
    this.logger.log(
      `Awarding badge ${badge.id} to users in tenants: ${tenantIds.join(', ')}`,
    );
    if (!badge.achievementParams?.count) {
      return;
    }

    try {
      let userCounts: UserValueCount[] = [];

      switch (badge.category) {
        case BadgeCategory.SIMULATION_MINUTES:
          this.logger.log(
            `Getting total simulation minutes per user for badge ${badge.id}`,
          );
          const totalSimulationMinutesPerUser =
            await this.communitySharedService.getTotalSimulationMinutesPerUser(
              tenantIds,
              userIds,
            );

          userCounts = totalSimulationMinutesPerUser.map((row) => ({
            userId: row.userId,
            value: row.totalMinutes,
          }));
          break;

        case BadgeCategory.COMMENTS_REACTIONS_GIVEN:
          this.logger.log(
            `Getting given comments/reactions count for badge ${badge.id}`,
          );
          const givenCounts = await this.getGivenCommentsOrReactionsCount(
            tenantIds,
            userIds,
          );

          userCounts = givenCounts.map((row) => ({
            userId: row.userId,
            value: row.count,
          }));
          break;

        case BadgeCategory.COMMENTS_REACTIONS_RECEIVED:
          this.logger.log(
            `Getting received comments/reactions count for badge ${badge.id}`,
          );
          const receivedCounts = await this.getReceivedCommentsOrReactionsCount(
            tenantIds,
            userIds,
          );

          userCounts = receivedCounts.map((row) => ({
            userId: row.userId,
            value: row.count,
          }));
          break;

        case BadgeCategory.ACTIVE_DAY_STREAK:
          this.logger.log(
            `Getting max active days per user for badge ${badge.id}`,
          );
          const maxActiveDaysPerUser =
            await this.communitySharedService.getMaxActiveDaysPerUser(
              tenantIds,
              userIds,
            );

          userCounts = maxActiveDaysPerUser.map((row) => ({
            userId: row.userId,
            value: row.maxStreak,
          }));
          break;
        default:
          throw new Error('Invalid badge category');
      }

      await this.saveBadgeUsersAboveThreshold(badge, userCounts);
    } catch (error) {
      this.logger.error(
        `Failed to award badge ${badge.id} to users in tenants: ${tenantIds.join(', ')}`,
        error.stack,
      );
    }
  }

  async saveBadgeUsers(badgeUsers: SaveBadgeUsersRequest): Promise<void> {
    await this.badgeUserRepository.save(badgeUsers);
  }

  private async saveBadgeUsersAboveThreshold(
    badge: Badge,
    userCounts: UserValueCount[],
  ): Promise<void> {
    if (userCounts.length === 0) {
      return;
    }

    const threshold = badge.achievementParams?.count || 0;
    const userBadges = userCounts
      .filter((row) => row.value >= threshold)
      .map((row) =>
        this.badgeUserRepository.create({
          userId: row.userId,
          badgeId: badge.id,
        }),
      );

    if (userBadges.length > 0) {
      await this.badgeUserRepository.save(userBadges);
      this.logger.log(
        `Badge ${badge.id} awarded to ${userBadges.length} users`,
      );
    }
  }

  async getSimulationMinutesByUserId(userId: number): Promise<number> {
    const userMinutesMap =
      await this.communitySharedService.getTotalSimulationMinutesPerUser(
        undefined,
        [userId],
      );
    return (
      userMinutesMap?.find((userMinutes) => userMinutes?.userId === userId)
        ?.totalMinutes ?? 0
    );
  }

  async getMaxActiveDayStreakByUserId(userId: number): Promise<number> {
    const userDayStreakMap =
      await this.communitySharedService.getMaxActiveDaysPerUser(undefined, [
        userId,
      ]);
    return (
      userDayStreakMap?.find((dayStreak) => dayStreak?.userId === userId)
        ?.maxStreak ?? 0
    );
  }

  async getGivenCommentsOrReactionsCount(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    const [givenComments, givenReviewReactions, givenCommentReactions] =
      await Promise.all([
        this.scenarioSessionReviewSharedService.getGivenCommentsCountPerUser(
          tenantIds,
          userIds,
        ),
        this.scenarioSessionReviewSharedService.getGivenReviewReactionsCountPerUser(
          tenantIds,
          userIds,
        ),
        this.scenarioSessionReviewSharedService.getGivenCommentsReactionsCountPerUser(
          tenantIds,
          userIds,
        ),
      ]);
    return this.mergeCountsByUserId([
      ...givenComments,
      ...givenReviewReactions,
      ...givenCommentReactions,
    ]);
  }

  async getReceivedCommentsOrReactionsCount(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    const [
      receivedComments,
      receivedReviewReactions,
      receivedCommentReactions,
    ] = await Promise.all([
      this.scenarioSessionReviewSharedService.getReceivedCommentsCountPerUser(
        tenantIds,
        userIds,
      ),
      this.scenarioSessionReviewSharedService.getReceivedReviewReactionsCountPerUser(
        tenantIds,
        userIds,
      ),
      this.scenarioSessionReviewSharedService.getReceivedCommentsReactionsCountPerUser(
        tenantIds,
        userIds,
      ),
    ]);
    return this.mergeCountsByUserId([
      ...receivedComments,
      ...receivedReviewReactions,
      ...receivedCommentReactions,
    ]);
  }

  private mergeCountsByUserId(
    items: { userId: number; count: number }[],
  ): { userId: number; count: number }[] {
    const userCountMap = new Map<number, number>();
    for (const item of items) {
      userCountMap.set(
        item.userId,
        (userCountMap.get(item.userId) || 0) + Number(item.count),
      );
    }
    return Array.from(userCountMap.entries()).map(([userId, count]) => ({
      userId,
      count,
    }));
  }

  async removeBadgeUsersForTenants(
    badgeId: string,
    tenantIds: string[],
    entityManager?: EntityManager,
  ): Promise<void> {
    if (tenantIds.length === 0) {
      return;
    }

    const badgeUserIds =
      await this.badgeUserRepository.findBadgeUserIdsByTenants(
        badgeId,
        tenantIds,
      );

    if (badgeUserIds.length > 0) {
      const badgeUserRepository =
        entityManager?.getRepository(BadgeUser) ?? this.badgeUserRepository;
      await badgeUserRepository.softDelete(badgeUserIds);
      this.logger.log(
        `Removed ${badgeUserIds.length} badge_user records for badge ${badgeId} from tenants: ${tenantIds.join(', ')}`,
      );
    }
  }

  async deleteUserBadges(userId: number, badgeIds: string[]): Promise<void> {
    await this.badgeUserRepository.softDelete({
      userId,
      badgeId: In(badgeIds),
    });
  }

  async deleteUserBadgeList(userBadgeIds: string[]): Promise<void> {
    await this.badgeUserRepository.softDelete({
      id: In(userBadgeIds),
    });
  }
}
