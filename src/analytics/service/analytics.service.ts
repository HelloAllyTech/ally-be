import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { DashboardDto } from '../type/analytics.type';
import { In, Repository } from 'typeorm';
import { Dashboard } from '../../common/entities/dashboard.entity';
import { Chat } from '../../common/entities/chat.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupService } from 'src/authorization/service/group.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AnalyticsUtil } from '../util/analytics.util';
import {
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
} from '../validation/analytics.validation';
import { UserRole } from 'src/common/constants/user.constants';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
    @InjectRepository(Dashboard)
    private readonly dashboardRepository: Repository<Dashboard>,
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
    private readonly groupService: GroupService,
  ) {}
  async refreshDashboardUrl(dashboardId: string) {
    return {
      url: await this.analyticsInterface.refreshDashboardUrl(dashboardId),
    };
  }

  async getDashboardUrl(dashboardId: string) {
    const dashboard = await this.dashboardRepository.findOne({
      where: {
        externalId: dashboardId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
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

  async createDashboard(dashboard: DashboardDto) {
    const existingDashboard = await this.dashboardRepository.findOne({
      where: {
        externalId: dashboard.externalId,
        tenantId: ExecutionManager.getTenantId(),
        groupId: dashboard.groupId,
      },
    });
    if (existingDashboard) {
      await this.dashboardRepository.update(
        { id: existingDashboard.id },
        {
          ...dashboard,
        },
      );
      return existingDashboard;
    }

    const group = await this.groupService.getGroupById(
      parseInt(dashboard.groupId),
    );
    if (!group) {
      throw new NotFoundException('Group not found');
    }
    const dashboardEntity = this.dashboardRepository.create({
      ...dashboard,
      tenantId: ExecutionManager.getTenantId(),
    });
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
    const query = this.chatRepository
      .createQueryBuilder('chat')
      .innerJoin('users', 'user', 'user.id = chat.counselorId')
      .innerJoin('call_details', 'callDetails', 'callDetails.chatId = chat.id')
      .select('user.name', 'counselorName')
      .addSelect(
        `SUM(("callDetails"."callInfo" ->> 'clientTalkingTime')::float)`,
        'counselorListeningDuration',
      )
      .addSelect(
        `SUM(("callDetails"."callInfo" ->> 'counselorTalkingTime')::float)`,
        'counselorSharingDuration',
      )
      .where(`callDetails.callInfo ->> 'clientTalkingTime' IS NOT NULL`)
      .andWhere(`(callDetails.callInfo ->> 'clientTalkingTime')::float > 0`)
      .andWhere(`callDetails.callInfo ->> 'counselorTalkingTime' IS NOT NULL`)
      .andWhere(`(callDetails.callInfo ->> 'counselorTalkingTime')::float >= 0`)
      .groupBy('user.name')
      .orderBy('user.name', 'ASC');

    if (queryParams.startDate && queryParams.endDate) {
      const startDateTime = `${queryParams.startDate} 00:00:00`;
      const endDateTime = `${queryParams.endDate} 23:59:59`;
      query.andWhere('"chat"."startedAt" BETWEEN :startDate AND :endDate', {
        startDate: startDateTime,
        endDate: endDateTime,
      });
    } else if (queryParams.startDate) {
      const startDateTime = `${queryParams.startDate} 00:00:00`;
      query.andWhere('"chat"."startedAt" >= :startDate', {
        startDate: startDateTime,
      });
    } else if (queryParams.endDate) {
      const endDateTime = `${queryParams.endDate} 23:59:59`;
      query.andWhere('"chat"."startedAt" <= :endDate', {
        endDate: endDateTime,
      });
    }

    query.andWhere('user.id = :userId', { userId });

    const result = await query.getRawOne();

    const counselorListeningDuration =
      parseFloat(result?.counselorListeningDuration) || 0;
    const counselorSharingDuration =
      parseFloat(result?.counselorSharingDuration) || 0;
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
