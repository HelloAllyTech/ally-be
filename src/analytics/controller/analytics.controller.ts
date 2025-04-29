import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AnalyticsService } from '../service/analytics.service';

@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard/:dashboardId')
  getDashboardUrl(
    @Param('dashboardId') dashboardId: string,
    @Query('params') params: any,
  ) {
    return this.analyticsService.getDashboardUrl(dashboardId, params);
  }

  @Post('dashboard/:dashboardId/refresh')
  refreshDashboardUrl(@Param('dashboardId') dashboardId: string) {
    return this.analyticsService.refreshDashboardUrl(dashboardId);
  }
}
