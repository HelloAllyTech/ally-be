import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BadgeRepository } from '../repository/badge.repository';
import {
  CreateBadgeDto,
  CreateBadgeResponseDto,
} from '../dto/create-badge.dto';
import { Badge } from '../entity/badge.entity';
import {
  BADGE_MANDATORY_FIELDS,
  BadgeStatus,
  BadgeLockStatus,
  BadgeViewedStatus,
} from '../constants/badge.constants';
import { DataSource, In } from 'typeorm';
import { TenantService } from 'src/tenant/service/tenant.service';
import { BadgeUserService } from './badge-user.service';
import { BadgeTenantService } from './badge-tenant.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { groupAndSortBadgesByCategory } from '../util/badge.util';
import {
  GroupedUserAvailableBadges,
  MarkBadgeViewedResponse,
  UserAvailableBadge,
  UserBadgeResponse,
} from '../type/badge-response.type';
import { NotFoundException } from 'src/exception/custom.exception';
import { BadgeUserRepository } from '../repository/badge-user.repository';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { BadgeGroupRepository } from '../repository/badge-group.repository';

@Injectable()
export class BadgeService {
  private readonly logger = new Logger(BadgeService.name);

  constructor(
    private readonly badgeRepository: BadgeRepository,
    private readonly badgeUserService: BadgeUserService,
    private readonly badgeTenantService: BadgeTenantService,
    private readonly dataSource: DataSource,
    private readonly tenantService: TenantService,
    private readonly badgeUserRepository: BadgeUserRepository,
    private readonly groupRepository: GroupRepository,
    private readonly badgeGroupRepository: BadgeGroupRepository,
  ) {}

  async createBadge(
    createBadgeDto: CreateBadgeDto,
  ): Promise<CreateBadgeResponseDto> {
    this.validateCreateBadgeDto(createBadgeDto);

    return await this.dataSource.transaction(async (entityManager) => {
      const badgeRepo = entityManager.getRepository(Badge);
      const badge = badgeRepo.create(createBadgeDto);
      const savedBadge = await badgeRepo.save(badge);
      if (createBadgeDto.groupIds && createBadgeDto.groupIds.length > 0) {
        const badgeGroups = createBadgeDto.groupIds.map((groupId) =>
          this.badgeGroupRepository.create({
            badgeId: savedBadge.id,
            groupId,
          }),
        );
        await this.badgeGroupRepository.save(badgeGroups);
      }

      if (savedBadge.status === BadgeStatus.ACTIVE) {
        // Run background job to assign badge to tenants and award badge to users
        this.badgeTenantService
          .assignBadgeToTenants(savedBadge, createBadgeDto.tenantIds)
          .then((assignedTenantIds) => {
            if (assignedTenantIds && assignedTenantIds.length > 0) {
              this.badgeUserService.awardBadgeToUsersByTenant(
                savedBadge,
                assignedTenantIds,
              );
            }
          });
      }
      return { id: savedBadge.id };
    });
  }

  private async validateCreateBadgeDto(
    createBadgeDto: CreateBadgeDto,
  ): Promise<void> {
    if (createBadgeDto.status === BadgeStatus.ACTIVE) {
      const missingFields = BADGE_MANDATORY_FIELDS.filter(
        (field) => !createBadgeDto[field as keyof typeof createBadgeDto],
      );
      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing for ACTIVE badge: ${missingFields.join(', ')}`,
        );
      }
    }
    if (createBadgeDto.groupIds && createBadgeDto.groupIds.length > 0) {
      const groups = await this.groupRepository.getAll({
        where: { id: In(createBadgeDto.groupIds) },
      });

      if (groups.length !== createBadgeDto.groupIds.length) {
        throw new NotFoundException(`One or more groups not found`);
      }
    }
    if (createBadgeDto.tenantIds && createBadgeDto.tenantIds.length > 0) {
      const tenantResults = await Promise.all(
        createBadgeDto.tenantIds.map(async (tenantId) => ({
          tenantId,
          tenant: await this.tenantService.findById(tenantId),
        })),
      );

      const invalidTenantIds = tenantResults
        .filter((result) => !result.tenant)
        .map((result) => result.tenantId);
      if (invalidTenantIds.length > 0) {
        throw new NotFoundException(`One or more tenants not found`);
      }
    }
  }

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
      awardedBadges.map((badge) => [badge.badgeId, badge.viewedStatus]),
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

  async markBadgeAsViewed(
    userId: number,
    badgeId: string,
  ): Promise<MarkBadgeViewedResponse> {
    const badgeUser = await this.badgeUserRepository.findOne({
      where: {
        userId,
        badgeId,
      },
    });

    if (!badgeUser) {
      throw new NotFoundException('Badge not found for user');
    }

    badgeUser.viewedStatus = BadgeViewedStatus.VIEWED;
    await this.badgeUserRepository.save(badgeUser);

    return {
      badgeId,
      viewedStatus: BadgeViewedStatus.VIEWED,
    };
  }

  async getAllBadges(): Promise<{ data: Badge[]; count: number }> {
    const [data, count] = await this.badgeRepository.findAndCount({
      order: {
        createdAt: 'DESC',
      },
    });
    return { data, count };
  }
}
