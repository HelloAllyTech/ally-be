import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  UpdateDashboardDto,
  DashboardResponseDTO,
  CreateDashboardResponseDto,
} from '../dto/analytics.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import { UserRole } from 'src/common/constants/user.constants';

@ApiTags('Analytics')
@Controller('v1/analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiOperation({ summary: 'Get all dashboards' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of all dashboards',
    type: DashboardResponseDTO,
    isArray: true,
  })
  @Get('dashboard/all')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  async getAllDashboards(): Promise<DashboardResponseDTO[]> {
    return this.analyticsService.getAllDashboards();
  }

  @Get('dashboard/:externalId')
  @AuthPermissions([PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL])
  getDashboardUrl(@Param() { externalId }: DashboardIdParamDto) {
    return this.analyticsService.getDashboardUrl(externalId);
  }

  @Post('dashboard/:externalId/refresh')
  @UseGuards(JwtAuthGuard)
  refreshDashboardUrl(@Param() { externalId }: DashboardIdParamDto) {
    return this.analyticsService.refreshDashboardUrl(externalId);
  }

  @Post('dashboard')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  createDashboard(
    @Body() dashboard: CreateDashboardDto,
  ): Promise<CreateDashboardResponseDto> {
    return this.analyticsService.createDashboard(dashboard);
  }

  @Get('dashboard')
  @AuthPermissions([PERMISSIONS.VIEW_ANALYTICS_DASHBOARD])
  getDashboards(@Req() req: { user: { id: number } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }

  @ApiOperation({ summary: 'Update a dashboard' })
  @ApiParam({
    name: 'dashboardId',
    type: String,
    description: 'The ID of the dashboard to update',
  })
  @ApiBody({ type: UpdateDashboardDto })
  @Patch('dashboard/:dashboardId')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  updateDashboard(
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() updateDashboardDto: UpdateDashboardDto,
  ) {
    return this.analyticsService.updateDashboard(
      dashboardId,
      updateDashboardDto,
    );
  }

  @AuthRoles(UserRole.COUNSELOR)
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
