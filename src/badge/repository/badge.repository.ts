import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Badge } from '../entity/badge.entity';
import { BadgeUser } from '../entity/badge-user.entity';
import { BadgeTenant } from '../entity/badge-tenant.entity';
import { BadgeGroup } from '../entity/badge-group.entity';
import { UserGroup } from 'src/authorization/entity/user-group.entity';
import {
  BadgeStatus,
  BadgeViewedStatus,
  BadgeCategory,
} from '../constants/badge.constants';
import {
  TenantBadgeResponse,
  UserBadgeWithDetails,
} from '../type/badge-response.type';
import { Pagination } from 'src/common/type/common.type';
import { BadgeSortBy } from '../enum/badge-sort-by.enum';
import { BadgeFilterDto } from '../dto/badge-filter.dto';

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
    enableGroupFilter?: boolean,
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

    if (enableGroupFilter) {
      query
        .leftJoin(BadgeGroup, 'badgeGroup', 'badgeGroup.badgeId = badge.id')
        .innerJoin(
          UserGroup,
          'userGroup',
          'userGroup.groupId = badgeGroup.groupId',
        )
        .andWhere('userGroup.userId = :userId', { userId });
    }

    if (viewedStatus) {
      query.andWhere('badgeUser.viewedStatus = :viewedStatus', {
        viewedStatus,
      });
    }

    return query.orderBy('badgeUser.createdAt', 'DESC').getRawMany();
  }

  async getBadgesByUserIds(userIds: number[]): Promise<UserBadgeWithDetails[]> {
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
        'badge.name AS "name"',
        'badge.description AS "description"',
        'badge.imageUrl AS "imageUrl"',
        'badge.category AS "category"',
        'badge.achievementParams AS "achievementParams"',
      ])
      .where('badgeUser.userId IN (:...userIds)', { userIds })
      .andWhere('badgeUser.deletedAt IS NULL')
      .andWhere('badge.deletedAt IS NULL')
      .andWhere('badge.status = :status', { status: BadgeStatus.ACTIVE });

    return query.orderBy('badgeUser.createdAt', 'DESC').getRawMany();
  }

  async getUserBadgeCount(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<number> {
    const query = this.dataSource
      .createQueryBuilder(BadgeUser, 'badgeUser')
      .innerJoin(Badge, 'badge', 'badge.id = badgeUser.badgeId')
      .innerJoin(BadgeGroup, 'badgeGroup', 'badgeGroup.badgeId = badge.id')
      .innerJoin(
        UserGroup,
        'userGroup',
        'userGroup.groupId = badgeGroup.groupId',
      )
      .where('badgeUser.userId = :userId', { userId })
      .andWhere('userGroup.userId = :userId', { userId })
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

  async getAllBadges(
    pagination: Pagination,
    filter?: BadgeFilterDto,
  ): Promise<[Badge[], number]> {
    const query = this.createQueryBuilder('badge');

    if (filter?.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      query.andWhere('(badge.name ILIKE :term)', {
        term,
      });
    }

    if (
      filter?.category &&
      Object.values(BadgeCategory).includes(filter.category)
    ) {
      query.andWhere('badge.category = :category', {
        category: filter.category,
      });
    }

    if (filter?.status && Object.values(BadgeStatus).includes(filter.status)) {
      query.andWhere('badge.status = :status', { status: filter.status });
    }

    this.applySorting(query, pagination);
    this.applyPagination(query, pagination);

    return query.getManyAndCount();
  }

  private applySorting(
    query: SelectQueryBuilder<Badge>,
    pagination: Pagination,
  ) {
    const sortColumn = this.getValidatedSortColumn(
      pagination.sortBy || BadgeSortBy.CREATED_AT,
    );
    if (sortColumn) {
      query.orderBy(`badge.${sortColumn}`, pagination.order || 'DESC');
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return BadgeSortBy.CREATED_AT;
    }
    const validColumns = Object.values(BadgeSortBy);
    return validColumns.includes(sortBy as BadgeSortBy)
      ? sortBy
      : BadgeSortBy.CREATED_AT;
  }

  private applyPagination(
    query: SelectQueryBuilder<Badge>,
    pagination: Pagination,
  ) {
    if (pagination.limit) {
      query.limit(pagination.limit);
    }
    if (pagination.offset) {
      query.offset(pagination.offset);
    }
  }

  async getUnawardedBadgesForUserRole(
    userId: number,
    groupId: number,
    tenantId?: string,
  ): Promise<Badge[]> {
    const query = this.dataSource
      .createQueryBuilder(Badge, 'badge')
      .innerJoin(BadgeGroup, 'badgeGroup', 'badgeGroup.badgeId = badge.id')
      .innerJoin(BadgeTenant, 'badgeTenant', 'badgeTenant.badgeId = badge.id')
      .leftJoin(
        BadgeUser,
        'badgeUser',
        'badgeUser.badgeId = badge.id AND badgeUser.userId = :userId AND badgeUser.deletedAt IS NULL',
        { userId },
      )
      .where('badgeGroup.groupId = :groupId', { groupId })
      .andWhere('badge.deletedAt IS NULL')
      .andWhere('badgeTenant.deletedAt IS NULL')
      .andWhere('badge.status = :status', { status: BadgeStatus.ACTIVE })
      .andWhere('badgeUser.id IS NULL');

    if (tenantId) {
      query.andWhere('badgeTenant.tenantId = :tenantId', { tenantId });
    }

    return query.setParameter('userId', userId).getMany();
  }
}
