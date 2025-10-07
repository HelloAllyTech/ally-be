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
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
} from '../validation/analytics.validation';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

@ApiTags('Analytics')
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard/:dashboardId')
  @UseGuards(JwtAuthGuard)
  getDashboardUrl(@Param() { dashboardId }: DashboardIdParamDto) {
    return this.analyticsService.getDashboardUrl(dashboardId);
  }

  @Post('dashboard/:dashboardId/refresh')
  @UseGuards(JwtAuthGuard)
  refreshDashboardUrl(@Param() { dashboardId }: DashboardIdParamDto) {
    return this.analyticsService.refreshDashboardUrl(dashboardId);
  }

  @Post('dashboard')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  createDashboard(@Body() dashboard: CreateDashboardDto) {
    return this.analyticsService.createDashboard(dashboard);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboards(@Req() req: { user: { id: number } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('counselor-stats')
  @ApiOperation({
    summary: 'Get counselor statistics',
    description:
      'Fetch counselor listening and sharing duration statistics with optional date range for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Counselor statistics retrieved successfully',
    type: [CounselorStatsResponseDto],
  })
  async getCounselorStats(
    @Query() queryParams: CounselorStatsQueryDto,
    @Req() req: { user: { id: number } },
  ): Promise<CounselorStatsResponseDto> {
    return this.analyticsService.getCounselorStats(queryParams, req.user.id);
  }
}
