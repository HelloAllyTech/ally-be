import { Injectable } from '@nestjs/common';
import { BadgeRepository } from '../repository/badge.repository';
import {
  BadgeLockStatus,
  BadgeViewedStatus,
} from '../constants/badge.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { BadgeUser } from '../entity/badge-user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { groupAndSortBadgesByCategory } from '../util/badge.util';
import {
  GroupedUserAvailableBadges,
  UserAvailableBadge,
  UserBadgeResponse,
} from '../type/badge-response.type';

@Injectable()
export class BadgeService {
  constructor(
    private readonly badgeRepository: BadgeRepository,
    @InjectRepository(BadgeUser)
    private readonly badgeUserRepository: Repository<BadgeUser>,
  ) {}

  async getUserBadges(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<UserBadgeResponse> {
    const badges = await this.badgeRepository.getUserBadges(
      userId,
      viewedStatus,
    );
    return {
      data: badges,
    };
  }

  async getUserBadgeCount(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<number> {
    return this.badgeRepository.getUserBadgeCount(userId, viewedStatus);
  }

  async getFormattedUserAvailableBadges(
    userId: number,
  ): Promise<GroupedUserAvailableBadges[]> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      return [];
    }

    // Get all badges assigned to the tenant
    const tenantBadges =
      await this.badgeRepository.getBadgesForTenant(tenantId);

    if (tenantBadges.length === 0) {
      return [];
    }

    // Get badge IDs that the user has access to through their groups
    const supportedUserGroupBadgeIds =
      await this.badgeRepository.getBadgeIdsForUserGroups(userId);

    const awardedBadges = await this.badgeUserRepository.find({
      where: {
        userId,
      },
    });
    const awardedBadgeMap = new Map(
      awardedBadges.map((ab) => [ab.badgeId, ab.viewedStatus]),
    );

    // Filter tenant badges to only include those the user has access to and set the viewedStatus and lockStatus
    const availableBadges: UserAvailableBadge[] = tenantBadges
      .filter((badge) =>
        supportedUserGroupBadgeIds.some((id) => id === badge.id),
      )
      .map((badge) => ({
        ...badge,
        viewedStatus: awardedBadgeMap.get(badge.id) ?? null,
        lockStatus: awardedBadgeMap.has(badge.id)
          ? BadgeLockStatus.UNLOCKED
          : BadgeLockStatus.LOCKED,
      }));

    // Group badges by category and sort by achievementParams.count
    return groupAndSortBadgesByCategory(availableBadges);
  }
}
