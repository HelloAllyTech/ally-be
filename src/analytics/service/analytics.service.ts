import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { In } from 'typeorm';
import { GroupService } from 'src/authorization/service/group.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AnalyticsUtil } from '../util/analytics.util';
import {
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
  CreateDashboardDto,
} from '../dto/analytics.dto';
import { UserRole } from 'src/common/constants/user.constants';
import { DashboardRepository } from '../repository/dashboard.repository';
import { ChatSharedService } from '../../chat/service/chat-shared.service';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
    private readonly dashboardRepository: DashboardRepository,
    private readonly chatSharedService: ChatSharedService,
    private readonly groupService: GroupService,
  ) {}
  async refreshDashboardUrl(dashboardId: string) {
    return {
      url: await this.analyticsInterface.refreshDashboardUrl(dashboardId),
    };
  }

  async getDashboardUrl(dashboardId: string) {
    const dashboard = await this.dashboardRepository.findByExternalIdAndTenant(
      dashboardId,
      ExecutionManager.getTenantId()!,
    );
    if (!dashboard) {
      throw new NotFoundException('Dashboard not found');
    }
    const paramKeyList = dashboard?.data?.params ?? [];
    const generatedParams = AnalyticsUtil.generateParamList(paramKeyList);
    const url = await this.analyticsInterface.getDashboardUrl(
      dashboardId,
      generatedParams,
    );
    return {
      url,
    };
  }

  async createDashboard(dashboard: CreateDashboardDto) {
    const existingDashboard =
      await this.dashboardRepository.findByExternalIdAndTenant(
        dashboard.externalId,
        dashboard.tenantId,
        dashboard.groupId,
      );
    if (existingDashboard) {
      await this.dashboardRepository.update(
        { id: existingDashboard.id },
        dashboard,
      );
      return existingDashboard;
    }
    const dashboardEntity = this.dashboardRepository.create(dashboard);
    return this.dashboardRepository.save(dashboardEntity);
  }

  async getDashboards(userId: number) {
    const ANALYTICS_TYPE: Partial<Record<UserRole, string>> = {
      [UserRole.COUNSELOR]: 'CALL_LOG_ANALYTICS',
      [UserRole.LEARNER]: 'SIMULATION_ANALYTICS',
      [UserRole.ADMIN]: 'ORG_ANALYTICS',
    };
    const userGroups = await this.groupService.getUserRolesByUserId(userId);

    const groupIds = userGroups.map((group) => group.id);
    if (!userGroups.length) return;
    const dashboards = await this.dashboardRepository.find({
      where: {
        groupId: In(groupIds),
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    const groupMap = Object.fromEntries(
      userGroups.map((group) => [group.id.toString(), group.name]),
    );

    return dashboards.map((dashboard) => {
      const roleName = groupMap[dashboard.groupId];
      const analyticsType = roleName
        ? (ANALYTICS_TYPE[roleName as keyof typeof ANALYTICS_TYPE] ?? '')
        : '';

      return {
        ...dashboard,
        analyticsType,
      };
    });
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
