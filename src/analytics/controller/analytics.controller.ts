import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../service/analytics.service';
import { DashboardDto } from '../type/analytics.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

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

  @Post('dashboard')
  createDashboard(@Body() dashboard: DashboardDto) {
    return this.analyticsService.createDashboard(dashboard);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboards(@Req() req: { user: { id: string } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }
}
