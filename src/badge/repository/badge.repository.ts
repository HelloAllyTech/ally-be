import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Badge } from '../entity/badge.entity';
import { BadgeUser } from '../entity/badge-user.entity';
import { BadgeStatus, BadgeViewedStatus } from '../constants/badge.constants';
import { UserBadgeWithDetails } from '../constants/badge-response.constants';

@Injectable()
export class BadgeRepository extends Repository<Badge> {
  constructor(private dataSource: DataSource) {
    super(Badge, dataSource.createEntityManager());
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
