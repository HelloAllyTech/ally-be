import { Inject, Injectable } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
  ) {}
  refreshDashboardUrl(dashboardId: string) {
    return this.analyticsInterface.refreshDashboardUrl(dashboardId);
  }
  getDashboardUrl(dashboardId: string, params: Record<string, any>) {
    return this.analyticsInterface.getDashboardUrl(dashboardId, params);
  }
}
