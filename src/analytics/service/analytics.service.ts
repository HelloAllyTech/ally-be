import { Inject, Injectable } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { DashboardDto } from '../type/analytics.type';
import { In, Repository } from 'typeorm';
import { Dashboard } from '../../common/entities/dashboard.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupService } from '../../user/group.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AnalyticsUtil } from '../util/analytics.util';
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
    @InjectRepository(Dashboard)
    private readonly dashboardRepository: Repository<Dashboard>,
    private readonly groupService: GroupService,
  ) {}
  async refreshDashboardUrl(dashboardId: string) {
    return {
      url: await this.analyticsInterface.refreshDashboardUrl(dashboardId),
    };
  }

  async getDashboardUrl(dashboardId: string, inputParams: Record<string, any>) {
    const dashboard = await this.dashboardRepository.findOne({
      where: {
        externalId: dashboardId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    if (!dashboard) {
      throw new Error('Dashboard not found');
    }
    const paramKeyList = dashboard?.data?.params ?? [];
    const generatedParams = AnalyticsUtil.generateParamList(paramKeyList);
    const url = await this.analyticsInterface.getDashboardUrl(dashboardId, {
      params: { ...inputParams, ...generatedParams },
    });
    return {
      url,
    };
  }

  createDashboard(dashboard: DashboardDto) {
    const dashboardEntity = this.dashboardRepository.create(dashboard);
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
}
