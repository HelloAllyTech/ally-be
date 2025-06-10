import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { DashboardDto } from '../type/analytics.type';
import { In, Repository } from 'typeorm';
import { Dashboard } from '../../common/entities/dashboard.entity';
import { Chat } from '../../common/entities/chat.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupService } from '../../user/group.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AnalyticsUtil } from '../util/analytics.util';
import {
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
} from '../validation/analytics.validation';

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
    const dashboardEntity = this.dashboardRepository.create({
      ...dashboard,
      tenantId: ExecutionManager.getTenantId(),
    });
    return this.dashboardRepository.save(dashboardEntity);
  }

  async getDashboards(userId: string) {
    const userGroups = await this.groupService.getUserGroups(userId);
    if (!userGroups.length) return;
    return this.dashboardRepository.find({
      where: {
        groupId: In(userGroups),
        tenantId: ExecutionManager.getTenantId(),
      },
    });
  }

  async getCounselorStats(
    queryParams: CounselorStatsQueryDto,
    userId: string,
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
      query.andWhere(
        '"callDetails"."createdAt" BETWEEN :startDate AND :endDate',
        {
          startDate: queryParams.startDate,
          endDate: queryParams.endDate,
        },
      );
    } else if (queryParams.startDate) {
      query.andWhere('"callDetails"."createdAt" >= :startDate', {
        startDate: queryParams.startDate,
      });
    } else if (queryParams.endDate) {
      query.andWhere('"callDetails"."createdAt" <= :endDate', {
        endDate: queryParams.endDate,
      });
    }

    query.andWhere('user.id = :userId', { userId: parseInt(userId) });

    const result = await query.getRawOne();

    if (!result) {
      throw new NotFoundException('Counselor stats not found');
    }

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
      counselorName: result.counselorName,
      counselorListeningDuration,
      counselorSharingDuration,
      counselorSharingPercentage: parseFloat(
        counselorSharingPercentage.toFixed(2),
      ),
    };
  }
}
