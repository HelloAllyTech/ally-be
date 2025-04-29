import { Inject, Injectable } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('AnalyticsInterface')
    private readonly analyticsInterface: AnalyticsInterface,
  ) {}
  async refreshDashboardUrl(dashboardId: string) {
    return {
      url: await this.analyticsInterface.refreshDashboardUrl(dashboardId),
    };
  }

  async getDashboardUrl(dashboardId: string, params: Record<string, any>) {
    const url = await this.analyticsInterface.getDashboardUrl(
      dashboardId,
      params,
    );
    return {
      url,
    };
  }
}
