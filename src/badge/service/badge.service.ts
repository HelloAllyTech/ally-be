import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BadgeRepository } from '../repository/badge.repository';
import {
  CreateBadgeDto,
  CreateBadgeResponseDto,
  CreateBadgesBatchDto,
  CreateBadgesBatchResponseDto,
  UpdateBadgeDto,
} from '../dto/badge.dto';
import { Badge } from '../entity/badge.entity';
import { BadgeUser } from '../entity/badge-user.entity';
import { BadgeGroup } from '../entity/badge-group.entity';
import {
  BADGE_MANDATORY_FIELDS,
  BadgeStatus,
  BadgeLockStatus,
  BadgeViewedStatus,
  BadgeVisibilityType,
  BadgeCategory,
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
  TenantBadgeResponse,
  UserAvailableBadge,
  UserBadgeResponse,
} from '../type/badge-response.type';
import isDuplicateKeyException, {
  NotFoundException,
} from 'src/exception/custom.exception';
import { BadgeUserRepository } from '../repository/badge-user.repository';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { BadgeGroupRepository } from '../repository/badge-group.repository';
import { BadgeTenant } from '../entity/badge-tenant.entity';

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
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    await this.validateCreateBadgeDto(createBadgeDto);

    return await this.dataSource.transaction(async (entityManager) => {
      const badgeRepo = entityManager.getRepository(Badge);

      const badge = badgeRepo.create({
        ...createBadgeDto,
        createdBy: userId,
        updatedBy: userId,
      });

      let savedBadge: Badge;
      try {
        savedBadge = await badgeRepo.save(badge);
      } catch (error) {
        if (isDuplicateKeyException(error)) {
          throw new BadRequestException('Badge with this code already exists');
        }
        throw error;
      }

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

  async createBadgesBatch(
    createBadgesBatchDto: CreateBadgesBatchDto,
  ): Promise<CreateBadgesBatchResponseDto> {
    const { badges } = createBadgesBatchDto;

    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    // 1. Validate all badges upfront (outside transaction)
    await this.validateBadgesBatch(badges);

    // 2. Single transaction for all inserts
    const savedBadges = await this.dataSource.transaction(
      async (entityManager) => {
        const badgeRepo = entityManager.getRepository(Badge);
        const badgeGroupRepo = entityManager.getRepository(BadgeGroup);

        // Bulk insert badges
        const badgeEntities = badges.map((dto) =>
          badgeRepo.create({
            ...dto,
            createdBy: userId,
            updatedBy: userId,
          }),
        );
        let inserted: Badge[];
        try {
          inserted = await badgeRepo.save(badgeEntities);
        } catch (error) {
          if (isDuplicateKeyException(error)) {
            throw new BadRequestException(
              'One or more badge codes already exists',
            );
          }
          throw error;
        }

        // Bulk insert badge-group mappings
        const allBadgeGroups: BadgeGroup[] = [];
        inserted.forEach((badge, index) => {
          const groupIds = badges[index].groupIds ?? [];
          groupIds.forEach((groupId) => {
            allBadgeGroups.push(
              badgeGroupRepo.create({ badgeId: badge.id, groupId }),
            );
          });
        });
        if (allBadgeGroups.length > 0) {
          await badgeGroupRepo.save(allBadgeGroups);
        }

        return inserted;
      },
    );

    // 3. Trigger async jobs for active badges (after transaction commits)
    for (let i = 0; i < savedBadges.length; i++) {
      const badge = savedBadges[i];
      if (badge.status === BadgeStatus.ACTIVE) {
        this.badgeTenantService
          .assignBadgeToTenants(badge, badges[i].tenantIds)
          .then((assignedTenantIds) => {
            if (assignedTenantIds && assignedTenantIds.length > 0) {
              this.badgeUserService.awardBadgeToUsersByTenant(
                badge,
                assignedTenantIds,
              );
            }
          });
      }
    }

    return { ids: savedBadges.map((b) => b.id) };
  }

  private async validateBadgesBatch(badges: CreateBadgeDto[]): Promise<void> {
    // Check for duplicate codes within the batch
    const codes = badges.map((b) => b.code);
    const duplicateCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (duplicateCodes.length > 0) {
      throw new BadRequestException(
        `Duplicate badge codes in batch: ${[...new Set(duplicateCodes)].join(', ')}`,
      );
    }

    // Validate mandatory fields for each badge
    for (const badge of badges) {
      this.validateMandatoryFieldsForActiveStatus(
        badge,
        badge.status ?? BadgeStatus.ACTIVE,
      );
    }

    // Collect all unique tenant/group IDs and validate once
    const allTenantIds = [...new Set(badges.flatMap((b) => b.tenantIds ?? []))];
    const allGroupIds = [...new Set(badges.flatMap((b) => b.groupIds ?? []))];
    await this.validateTenantAndGroupIds(
      allTenantIds.length > 0 ? allTenantIds : undefined,
      allGroupIds.length > 0 ? allGroupIds : undefined,
    );
  }

  private validateMandatoryFieldsForActiveStatus(
    badgeData: Partial<CreateBadgeDto & Badge>,
    targetStatus: BadgeStatus,
  ): void {
    if (targetStatus === BadgeStatus.ACTIVE) {
      const missingFields = BADGE_MANDATORY_FIELDS.filter(
        (field) => !badgeData[field as keyof typeof badgeData],
      );
      if (missingFields.length > 0) {
        throw new BadRequestException(
          `The following required fields are missing for ACTIVE badge: ${missingFields.join(', ')}`,
        );
      }
    }
  }

  private async validateTenantAndGroupIds(
    tenantIds?: string[],
    groupIds?: number[],
  ): Promise<void> {
    if (groupIds && groupIds.length > 0) {
      const groups = await this.groupRepository.getAll({
        where: { id: In(groupIds) },
      });

      if (groups.length !== groupIds.length) {
        throw new NotFoundException(`One or more groups not found`);
      }
    }
    if (tenantIds && tenantIds.length > 0) {
      const tenantResults = await Promise.all(
        tenantIds.map(async (tenantId) => ({
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

  private async validateCreateBadgeDto(
    createBadgeDto: CreateBadgeDto,
  ): Promise<void> {
    this.validateMandatoryFieldsForActiveStatus(
      createBadgeDto,
      createBadgeDto.status ?? BadgeStatus.ACTIVE,
    );
    await this.validateTenantAndGroupIds(
      createBadgeDto.tenantIds,
      createBadgeDto.groupIds,
    );
  }

  private async validateUpdateBadgeDto(
    badge: Badge,
    updateBadgeDto: UpdateBadgeDto,
  ): Promise<void> {
    // Validate status transition: cannot change from ACTIVE to DRAFT
    if (
      updateBadgeDto.status === BadgeStatus.DRAFT &&
      badge.status === BadgeStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Cannot change badge status from ACTIVE to DRAFT',
      );
    }

    // Block achievementParams changes if badge is ACTIVE
    if (
      badge.status === BadgeStatus.ACTIVE &&
      (updateBadgeDto.achievementParams !== undefined ||
        updateBadgeDto.category !== undefined)
    ) {
      throw new BadRequestException(
        `Cannot modify ${updateBadgeDto.achievementParams !== undefined ? 'achievement parameters' : 'category'} for an active badge`,
      );
    }

    // Validate tenantIds and groupIds
    await this.validateTenantAndGroupIds(
      updateBadgeDto.tenantIds,
      updateBadgeDto.groupIds,
    );

    // Validate mandatory fields for ACTIVE status (check merged badge data)
    const targetStatus = updateBadgeDto.status ?? badge.status;

    // Get current groupIds from badge_groups table if not provided in update
    let currentGroupIds: number[] | undefined;
    if (updateBadgeDto.groupIds === undefined) {
      const badgeGroups = await this.badgeGroupRepository.findByBadgeId(
        badge.id,
      );
      currentGroupIds = badgeGroups.map((badgeGroup) => badgeGroup.groupId);
    }

    const mergedBadgeData = {
      ...badge,
      ...updateBadgeDto,
      groupIds: updateBadgeDto.groupIds ?? currentGroupIds,
    };
    this.validateMandatoryFieldsForActiveStatus(mergedBadgeData, targetStatus);
  }

  async getUserBadges(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
    enableGroupFilter: boolean = false,
  ): Promise<UserBadgeResponse> {
    const badges = await this.badgeRepository.getUserBadges(
      userId,
      viewedStatus,
      enableGroupFilter,
    );
    return {
      data: badges,
    };
  }

  async getBadgesByUserIdList(userIds: number[]) {
    return await this.badgeRepository.getBadgesByUserIds(userIds);
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

  async updateBadge(
    badgeId: string,
    updateBadgeDto: UpdateBadgeDto,
  ): Promise<boolean> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const badge = await this.badgeRepository.findOne({
      where: { id: badgeId },
    });
    if (!badge) {
      throw new NotFoundException('Badge not found');
    }

    await this.validateUpdateBadgeDto(badge, updateBadgeDto);

    return await this.dataSource.transaction(async (entityManager) => {
      const badgeRepo = entityManager.getRepository(Badge);

      // 1. Update badge fields
      const updateData = this.buildBadgeUpdateData(updateBadgeDto, userId);

      if (Object.keys(updateData).length > 0) {
        try {
          await badgeRepo.update(badgeId, updateData);
        } catch (error) {
          if (isDuplicateKeyException(error)) {
            throw new BadRequestException(
              'Badge with this code already exists',
            );
          }
          throw error;
        }
      }

      // 2. Handle group updates if provided
      if (updateBadgeDto.groupIds !== undefined) {
        // Remove existing group associations
        await this.badgeGroupRepository.delete({ badgeId });

        // Add new group associations
        if (updateBadgeDto.groupIds.length > 0) {
          const badgeGroups = updateBadgeDto.groupIds.map((groupId) =>
            this.badgeGroupRepository.create({
              badgeId,
              groupId,
            }),
          );
          await this.badgeGroupRepository.save(badgeGroups);
        }
      }

      // 3. If status is/becomes ACTIVE, handle tenant assignments and visibility changes
      const targetStatus = updateBadgeDto.status ?? badge.status;
      if (targetStatus === BadgeStatus.ACTIVE) {
        const updatedBadge = await badgeRepo.findOne({
          where: { id: badgeId },
        });
        if (!updatedBadge) {
          return true;
        }

        // If badge was not active before, assign to tenants and award
        if (badge.status !== BadgeStatus.ACTIVE) {
          this.badgeTenantService
            .assignBadgeToTenants(updatedBadge, updateBadgeDto.tenantIds)
            .then((assignedTenantIds) => {
              if (assignedTenantIds && assignedTenantIds.length > 0) {
                this.badgeUserService.awardBadgeToUsersByTenant(
                  updatedBadge,
                  assignedTenantIds,
                );
              }
            });
        } else {
          // Badge was already active, handle visibility changes and tenant updates
          const newVisibility =
            updateBadgeDto.visibilityType ?? badge.visibilityType;

          const currentTenantIds =
            await this.badgeTenantService.getTenantIdsForBadge(badgeId);

          // Determine target tenants based on new visibility
          let targetTenantIds: string[];
          if (newVisibility === BadgeVisibilityType.PUBLIC) {
            targetTenantIds = (await this.tenantService.findAll()).map(
              (tenant) => tenant.id,
            );
          } else if (updateBadgeDto.tenantIds) {
            targetTenantIds = updateBadgeDto.tenantIds;
          } else {
            targetTenantIds = currentTenantIds; // No change
          }

          const targetTenantIdSet = new Set(targetTenantIds);

          // Calculate tenants to remove and add
          const tenantIdsToRemove = currentTenantIds.filter(
            (id) => !targetTenantIdSet.has(id),
          );
          const tenantIdsToAdd = targetTenantIds.filter(
            (id) => !currentTenantIds.includes(id),
          );

          // Apply removals
          if (tenantIdsToRemove.length > 0) {
            await this.badgeTenantService.removeBadgeFromTenants(
              badgeId,
              tenantIdsToRemove,
            );
            await this.badgeUserService.removeBadgeUsersForTenants(
              badgeId,
              tenantIdsToRemove,
            );
          }

          // Apply additions
          if (tenantIdsToAdd.length > 0) {
            await this.badgeTenantService.updateBadgeTenants(
              badgeId,
              tenantIdsToAdd,
            );
            this.badgeUserService.awardBadgeToUsersByTenant(
              updatedBadge,
              tenantIdsToAdd,
            );
          }
        }
      }

      return true;
    });
  }

  async deleteBadge(badgeId: string): Promise<boolean> {
    const badge = await this.badgeRepository.findOne({
      where: { id: badgeId },
    });
    if (!badge) {
      throw new NotFoundException('Badge not found');
    }

    return await this.dataSource.transaction(async (entityManager) => {
      // Soft-delete related records
      await entityManager.getRepository(BadgeTenant).softDelete({ badgeId });
      await entityManager.getRepository(BadgeUser).softDelete({ badgeId });
      await entityManager.getRepository(BadgeGroup).softDelete({ badgeId });

      // Soft-delete the badge
      await entityManager.getRepository(Badge).softDelete(badgeId);

      return true;
    });
  }

  private buildBadgeUpdateData(
    updateBadgeDto: UpdateBadgeDto,
    userId: number,
  ): Partial<Badge> {
    const updateData: Partial<Badge> = {};
    if (updateBadgeDto.code !== undefined)
      updateData.code = updateBadgeDto.code;
    if (updateBadgeDto.name !== undefined)
      updateData.name = updateBadgeDto.name;
    if (updateBadgeDto.description !== undefined)
      updateData.description = updateBadgeDto.description;
    if (updateBadgeDto.imageUrl !== undefined)
      updateData.imageUrl = updateBadgeDto.imageUrl;
    if (updateBadgeDto.status !== undefined)
      updateData.status = updateBadgeDto.status;
    if (updateBadgeDto.visibilityType !== undefined)
      updateData.visibilityType = updateBadgeDto.visibilityType;
    if (updateBadgeDto.category !== undefined)
      updateData.category = updateBadgeDto.category;
    if (updateBadgeDto.achievementParams !== undefined)
      updateData.achievementParams = updateBadgeDto.achievementParams;
    updateData.updatedBy = userId;
    return updateData;
  }

  /**
   * Get badges that are available to the user (via tenant + group access)
   * but have NOT yet been awarded.
   * Optionally filter by badge category.
   */
  async getAvailableUnawardedBadges(
    userId: number,
    category?: BadgeCategory,
  ): Promise<TenantBadgeResponse[]> {
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
    const awardedBadgeIds = new Set(
      awardedBadges.map((badge) => badge.badgeId),
    );

    // Filter tenant badges to only include those the user has access to and is not awarded currently
    return tenantBadges.filter(
      (badge) =>
        supportedUserGroupBadgeIds.some((id) => id === badge.id) &&
        !awardedBadgeIds.has(badge.id) &&
        (category ? badge.category === category : true),
    );
  }
}
