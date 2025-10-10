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
} from '../dto/analytics.dto';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { GetCounselorStats } from '../decorator/api-documentation.decorator';

@ApiTags('Analytics')
@Controller('v1/analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
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
  @AuthRoles(UserRole.ADMIN)
  createDashboard(@Body() dashboard: CreateDashboardDto) {
    return this.analyticsService.createDashboard(dashboard);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboards(@Req() req: { user: { id: number } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }

  @GetCounselorStats()
  @UseGuards(JwtAuthGuard)
  @Get('counselor-stats')
  async getCounselorStats(
    @Query() queryParams: CounselorStatsQueryDto,
    @Req() req: { user: { id: number } },
  ): Promise<CounselorStatsResponseDto> {
    return this.analyticsService.getCounselorStats(queryParams, req.user.id);
  }
}
