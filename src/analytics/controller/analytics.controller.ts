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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreateDashboardDto,
  DashboardIdParamDto,
  DashboardParamsDto,
} from '../validation/analytics.validation';

@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard/:dashboardId')
  getDashboardUrl(
    @Param() { dashboardId }: DashboardIdParamDto,
    @Query() { params }: DashboardParamsDto,
  ) {
    return this.analyticsService.getDashboardUrl(dashboardId, params || {});
  }

  @Post('dashboard/:dashboardId/refresh')
  refreshDashboardUrl(@Param() { dashboardId }: DashboardIdParamDto) {
    return this.analyticsService.refreshDashboardUrl(dashboardId);
  }

  @Post('dashboard')
  createDashboard(@Body() dashboard: CreateDashboardDto) {
    return this.analyticsService.createDashboard(dashboard);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboards(@Req() req: { user: { id: string } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }
}
