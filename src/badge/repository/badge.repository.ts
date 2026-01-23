import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Badge } from '../entity/badge.entity';
import { BadgeUser } from '../entity/badge-user.entity';
import { BadgeTenant } from '../entity/badge-tenant.entity';
import { BadgeGroup } from '../entity/badge-group.entity';
import { UserGroup } from 'src/authorization/entity/user-group.entity';
import { BadgeStatus, BadgeViewedStatus } from '../constants/badge.constants';
import {
  TenantBadgeResponse,
  UserBadgeWithDetails,
} from '../type/badge-response.type';

@Injectable()
export class BadgeRepository extends Repository<Badge> {
  constructor(private dataSource: DataSource) {
    super(Badge, dataSource.createEntityManager());
  }

  async getBadgesForTenant(tenantId: string): Promise<TenantBadgeResponse[]> {
    return this.dataSource
      .createQueryBuilder(Badge, 'badge')
      .innerJoin(
        BadgeTenant,
        'badgeTenant',
        'badgeTenant.badgeId = badge.id AND badgeTenant.deletedAt IS NULL',
      )
      .select([
        'badge.id AS "id"',
        'badge.code AS "code"',
        'badge.name AS "name"',
        'badge.description AS "description"',
        'badge.imageUrl AS "imageUrl"',
        'badge.category AS "category"',
        'badge.achievementParams AS "achievementParams"',
      ])
      .where('badgeTenant.tenantId = :tenantId', { tenantId })
      .andWhere('badge.deletedAt IS NULL')
      .andWhere('badge.status = :status', { status: BadgeStatus.ACTIVE })
      .getRawMany();
  }

  async getBadgeIdsForUserGroups(userId: number): Promise<string[]> {
    const results = await this.dataSource
      .createQueryBuilder(BadgeGroup, 'badgeGroup')
      .innerJoin(
        UserGroup,
        'userGroup',
        'userGroup.groupId = badgeGroup.groupId',
      )
      .select('DISTINCT badgeGroup.badgeId', 'badgeId')
      .where('userGroup.userId = :userId', { userId })
      .andWhere('badgeGroup.deletedAt IS NULL')
      .getRawMany();

    return results.map((r) => r.badgeId);
  }

  async getUserBadges(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<UserBadgeWithDetails[]> {
    const query = this.dataSource
      .createQueryBuilder(BadgeUser, 'badgeUser')
      .innerJoin(Badge, 'badge', 'badge.id = badgeUser.badgeId')
      .select([
        'badgeUser.id AS "id"',
        'badgeUser.badgeId AS "badgeId"',
        'badgeUser.userId AS "userId"',
        'badgeUser.viewedStatus AS "viewedStatus"',
        'badgeUser.createdAt AS "createdAt"',
        'badge.id AS "badge_id"',
        'badge.code AS "code"',
        'badge.name AS "name"',
        'badge.description AS "description"',
        'badge.imageUrl AS "imageUrl"',
        'badge.category AS "category"',
        'badge.achievementParams AS "achievementParams"',
      ])
      .where('badgeUser.userId = :userId', { userId })
      .andWhere('badgeUser.deletedAt IS NULL')
      .andWhere('badge.deletedAt IS NULL')
      .andWhere('badge.status = :status', { status: BadgeStatus.ACTIVE });

    if (viewedStatus) {
      query.andWhere('badgeUser.viewedStatus = :viewedStatus', {
        viewedStatus,
      });
    }

    return query.orderBy('badgeUser.createdAt', 'DESC').getRawMany();
  }

  async getUserBadgeCount(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<number> {
    const query = this.dataSource
      .createQueryBuilder(BadgeUser, 'badgeUser')
      .innerJoin(Badge, 'badge', 'badge.id = badgeUser.badgeId')
      .where('badgeUser.userId = :userId', { userId })
      .andWhere('badgeUser.deletedAt IS NULL')
      .andWhere('badge.deletedAt IS NULL')
      .andWhere('badge.status = :status', { status: BadgeStatus.ACTIVE });

    if (viewedStatus) {
      query.andWhere('badgeUser.viewedStatus = :viewedStatus', {
        viewedStatus,
      });
    }

    return query.getCount();
  }
}
