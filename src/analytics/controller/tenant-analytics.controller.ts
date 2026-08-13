import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { EnableAnalyticsDto } from '../dto/enable-analytics.dto';
import {
  CourseUsageQueryDto,
  CourseUsageResponseDto,
  LearnerUsageQueryDto,
  LearnerUsageResponseDto,
  OrganizationMetricsQueryDto,
  OrganizationMetricsResponseDto,
} from '../dto/tenant-analytics.dto';
import { AnalyticsService } from '../service/analytics.service';
import { TenantAnalyticsService } from '../service/tenant-analytics.service';

@ApiTags('Tenant Analytics')
@Controller('v1/tenant-analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class TenantAnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly tenantAnalyticsService: TenantAnalyticsService,
  ) {}

  /**
   * Organization Metrics for the caller's own tenant (tenant-admin native
   * dashboard). The tenant is taken from the JWT — never from the client —
   * so a tenant admin can only ever read their own organization's numbers.
   */
  @Get('organization-metrics')
  @ApiOperation({
    summary:
      "Organization metrics (simulations completed, active users) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: OrganizationMetricsResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getOrganizationMetrics(
    @Query() query: OrganizationMetricsQueryDto,
  ): Promise<OrganizationMetricsResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getOrganizationMetrics(
      tenantId,
      query.range ?? '30d',
    );
  }

  /**
   * Per-learner usage table for the caller's own tenant. Same JWT-scoped
   * tenant + permission gate as `organization-metrics` — a tenant admin can
   * only ever see their own organization's learners.
   */
  @Get('learner-usage')
  @ApiOperation({
    summary:
      "Per-learner usage table (name, activity recency, roleplay + course progress) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: LearnerUsageResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getLearnerUsage(
    @Query() query: LearnerUsageQueryDto,
  ): Promise<LearnerUsageResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getLearnerUsage(tenantId, query);
  }

  /**
   * Per-course (Track 2.0) usage table for the caller's own tenant. Same
   * JWT-scoped tenant + permission gate as `organization-metrics`.
   */
  @Get('course-usage')
  @ApiOperation({
    summary:
      "Per-course usage table (assigned/started/completion + timing) for the caller's tenant",
  })
  @ApiResponse({ status: 200, type: CourseUsageResponseDto })
  @AuthPermissions([PERMISSIONS.VIEW_ORGANIZATION_METRICS])
  async getCourseUsage(
    @Query() query: CourseUsageQueryDto,
  ): Promise<CourseUsageResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('No tenant in the auth context');
    }
    return this.tenantAnalyticsService.getCourseUsage(tenantId, query);
  }

  @Patch('dashboards')
  @ApiOperation({ summary: 'Update tenant dashboards' })
  @ApiBody({ type: EnableAnalyticsDto })
  @ApiResponse({ status: 200, description: 'Tenant dashboards updated' })
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  async updateTenantDashboards(
    @Body() enableAnalyticsDto: EnableAnalyticsDto,
  ): Promise<boolean> {
    return this.analyticsService.updateTenantDashboards(enableAnalyticsDto);
  }
}
