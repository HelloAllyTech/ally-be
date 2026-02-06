import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { DataSource, In, Repository } from 'typeorm';
import { GroupService } from 'src/authorization/service/group.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AnalyticsUtil } from '../util/analytics.util';
import {
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
  CreateDashboardDto,
  CreateDashboardResponseDto,
  DashboardResponseDTO,
  UpdateDashboardDto,
} from '../dto/analytics.dto';
import { DashboardRepository } from '../repository/dashboard.repository';
import { ChatSharedService } from '../../chat/service/chat-shared.service';
import { TenantService } from 'src/tenant/service/tenant.service';
import { Dashboard } from '../entity/dashboards.entity';
import { DashboardTenant } from '../entity/dashboard-tenant.entity';
import { DashboardGroup } from '../entity/dashboard-group.entity';
import { EnableAnalyticsDto as UpdateTenantDashboardsDto } from '../dto/enable-analytics.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class AnalyticsService {
  private logger = LoggerService.getInstance(AnalyticsService.name);

  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
    private readonly dashboardRepository: DashboardRepository,
    @InjectRepository(DashboardTenant)
    private readonly dashboardTenantRepository: Repository<DashboardTenant>,
    private readonly chatSharedService: ChatSharedService,
    private readonly groupService: GroupService,
    private readonly tenantService: TenantService,
    private readonly dataSource: DataSource,
  ) {}

  async refreshDashboardUrl(externalId: string) {
    return {
      url: await this.analyticsInterface.refreshDashboardUrl(externalId),
    };
  }

  async getDashboardUrl(externalId: string) {
    const dashboard = await this.dashboardRepository.findByExternalIdAndTenant(
      externalId,
      ExecutionManager.getTenantId()!,
    );
    if (!dashboard) {
      throw new NotFoundException('Dashboard not found');
    }
    const paramKeyList = dashboard?.metadata?.params ?? [];
    const generatedParams = AnalyticsUtil.generateParamList(paramKeyList);
    const url = await this.analyticsInterface.getDashboardUrl(
      externalId,
      generatedParams,
    );
    return {
      url,
    };
  }

  async createDashboard(
    dashboard: CreateDashboardDto,
  ): Promise<CreateDashboardResponseDto> {
    const existingDashboard = await this.dashboardRepository.findByExternalId(
      dashboard.externalId,
    );
    if (existingDashboard) {
      throw new BadRequestException('Dashboard already exists');
    }
    await this.validateTenantAndGroupIds(
      dashboard.tenantIds,
      dashboard.groupIds,
    );

    return await this.dataSource.transaction(async (entityManager) => {
      const dashboardRepo = entityManager.getRepository(Dashboard);
      const dashboardTenantRepo = entityManager.getRepository(DashboardTenant);
      const dashboardGroupRepo = entityManager.getRepository(DashboardGroup);

      const dashboardEntity = dashboardRepo.create(dashboard);
      const savedDashboard = await dashboardRepo.save(dashboardEntity);

      const tenantEntities = dashboard.tenantIds?.map((tenantId) =>
        dashboardTenantRepo.create({
          dashboardId: savedDashboard.id,
          tenantId,
        }),
      );
      const groupEntities = dashboard.groupIds?.map((groupId) =>
        dashboardGroupRepo.create({ dashboardId: savedDashboard.id, groupId }),
      );

      if (tenantEntities && tenantEntities.length > 0) {
        await dashboardTenantRepo.save(tenantEntities);
      }
      if (groupEntities && groupEntities.length > 0) {
        await dashboardGroupRepo.save(groupEntities);
      }
      this.logger.info(`Dashboard created id=${savedDashboard.id}`);
      return { id: savedDashboard.id };
    });
  }

  async updateDashboard(
    dashboardId: string,
    updateDashboardDto: UpdateDashboardDto,
  ) {
    const existingDashboard = await this.dashboardRepository.findOne({
      where: {
        id: dashboardId,
      },
    });
    if (!existingDashboard) {
      throw new BadRequestException('Dashboard not found');
    }
    await this.validateTenantAndGroupIds(
      updateDashboardDto.tenantIds,
      updateDashboardDto.groupIds,
    );

    if (
      updateDashboardDto.externalId &&
      updateDashboardDto.externalId !== existingDashboard.externalId
    ) {
      const existingDashboardWithSameExternalId =
        await this.dashboardRepository.findByExternalId(
          updateDashboardDto.externalId,
        );
      if (existingDashboardWithSameExternalId) {
        throw new BadRequestException(
          'Dashboard with this external ID already exists',
        );
      }
    }

    await this.dataSource.transaction(async (entityManager) => {
      const dashboardRepo = entityManager.getRepository(Dashboard);
      const dashboardTenantRepo = entityManager.getRepository(DashboardTenant);
      const dashboardGroupRepo = entityManager.getRepository(DashboardGroup);

      const dashboardEntity = dashboardRepo.create(updateDashboardDto);
      await dashboardRepo.update(dashboardId, dashboardEntity);

      if (updateDashboardDto.tenantIds !== undefined) {
        const existingTenants = await dashboardTenantRepo.find({
          where: { dashboardId },
          select: ['id', 'tenantId'],
        });
        const existingTenantIds = new Set(
          existingTenants.map((t) => t.tenantId),
        );
        const incomingTenantIds = new Set(updateDashboardDto.tenantIds ?? []);

        const tenantIdsToAdd = [...incomingTenantIds].filter(
          (id) => !existingTenantIds.has(id),
        );
        const tenantIdsToRemove = [...existingTenantIds].filter(
          (id) => !incomingTenantIds.has(id),
        );

        if (tenantIdsToRemove.length > 0) {
          await dashboardTenantRepo.softDelete({
            dashboardId,
            tenantId: In(tenantIdsToRemove),
          });
        }
        if (tenantIdsToAdd.length > 0) {
          const tenantEntities = tenantIdsToAdd.map((tenantId) =>
            dashboardTenantRepo.create({ dashboardId, tenantId }),
          );
          await dashboardTenantRepo.save(tenantEntities);
        }
      }
      if (updateDashboardDto.groupIds !== undefined) {
        const existingGroups = await dashboardGroupRepo.find({
          where: { dashboardId },
          select: ['id', 'groupId'],
        });
        const existingGroupIds = new Set(existingGroups.map((g) => g.groupId));
        const incomingGroupIds = new Set(updateDashboardDto.groupIds ?? []);

        const groupIdsToAdd = [...incomingGroupIds].filter(
          (id) => !existingGroupIds.has(id),
        );
        const groupIdsToRemove = [...existingGroupIds].filter(
          (id) => !incomingGroupIds.has(id),
        );

        if (groupIdsToRemove.length > 0) {
          await dashboardGroupRepo.softDelete({
            dashboardId,
            groupId: In(groupIdsToRemove),
          });
        }
        if (groupIdsToAdd.length > 0) {
          const groupEntities = groupIdsToAdd.map((groupId) =>
            dashboardGroupRepo.create({ dashboardId, groupId }),
          );
          await dashboardGroupRepo.save(groupEntities);
        }
      }

      this.logger.info(`Dashboard updated id=${dashboardId}`);
      return true;
    });
  }

  private async validateTenantAndGroupIds(
    tenantIds?: string[],
    groupIds?: number[],
  ): Promise<void> {
    if (groupIds && groupIds.length > 0) {
      const groupIdSet = new Set(groupIds);
      const groups = await this.groupService.getGroupNames([...groupIdSet]);
      if (groups.length !== groupIdSet.size) {
        throw new NotFoundException(`One or more groups not found`);
      }
    }
    if (tenantIds && tenantIds.length > 0) {
      const tenantIdSet = new Set(tenantIds);
      const tenantResults = await Promise.all(
        [...tenantIdSet].map(async (tenantId) => ({
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

  async getDashboards(userId: number) {
    const userGroups = await this.groupService.getUserRolesByUserId(userId);
    const groupIds = userGroups.map((group) => group.id);
    if (!userGroups.length) return;

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const dashboards = await this.dashboardRepository.findByGroupIdAndTenant(
      tenantId,
      groupIds,
    );

    return dashboards;
  }

  async updateTenantDashboards(
    updateTenantDashboardsDto: UpdateTenantDashboardsDto,
  ) {
    const { dashboardIds, tenantId } = updateTenantDashboardsDto;
    const tenant = await this.tenantService.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    const requestedDashboardIdSet = new Set(dashboardIds ?? []);
    if (requestedDashboardIdSet.size > 0) {
      const dashboards = await this.dashboardRepository.find({
        where: { id: In([...requestedDashboardIdSet]) },
        select: ['id'],
      });
      if (dashboards.length !== requestedDashboardIdSet.size) {
        throw new NotFoundException('One or more dashboards not found');
      }
    }

    const existingDashboards = await this.dashboardTenantRepository.find({
      where: { tenantId },
      select: ['dashboardId'],
    });
    const existingDashboardIds = new Set(
      existingDashboards.map((link) => link.dashboardId),
    );

    const dashboardsToAdd = [...requestedDashboardIdSet].filter(
      (id) => !existingDashboardIds.has(id),
    );
    const dashboardsToRemove = [...existingDashboardIds].filter(
      (id) => !requestedDashboardIdSet.has(id),
    );

    if (dashboardsToRemove.length > 0) {
      await this.dashboardTenantRepository.softDelete({
        tenantId,
        dashboardId: In(dashboardsToRemove),
      });
    }
    if (dashboardsToAdd.length > 0) {
      const tenantEntities = dashboardsToAdd.map((dashboardId) =>
        this.dashboardTenantRepository.create({ dashboardId, tenantId }),
      );
      await this.dashboardTenantRepository.save(tenantEntities);
    }

    this.logger.info(
      `Tenant dashboards updated tenant=${tenantId} added=${dashboardsToAdd.length} removed=${dashboardsToRemove.length}`,
    );
    return true;
  }

  async getAllDashboards(): Promise<DashboardResponseDTO[]> {
    return this.dashboardRepository.find();
  }

  async getCounselorStats(
    queryParams: CounselorStatsQueryDto,
    userId: number,
  ): Promise<CounselorStatsResponseDto> {
    const result = await this.chatSharedService.getCounselorStatsRaw(
      queryParams,
      userId,
    );

    const counselorListeningDuration =
      parseFloat(result?.counselorListeningDuration ?? '0') || 0;
    const counselorSharingDuration =
      parseFloat(result?.counselorSharingDuration ?? '0') || 0;
    const totalTalkingTime =
      counselorListeningDuration + counselorSharingDuration;
    const counselorSharingPercentage =
      totalTalkingTime > 0
        ? (counselorSharingDuration / totalTalkingTime) * 100
        : 0;

    return {
      counselorName: result?.counselorName || '',
      counselorListeningDuration,
      counselorSharingDuration,
      counselorSharingPercentage: parseFloat(
        counselorSharingPercentage.toFixed(2),
      ),
    };
  }
}
