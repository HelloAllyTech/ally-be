import { Body, Controller, Patch } from '@nestjs/common';
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
import { EnableAnalyticsDto } from '../dto/enable-analytics.dto';
import { AnalyticsService } from '../service/analytics.service';

@ApiTags('Tenant Analytics')
@Controller('v1/tenant-analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class TenantAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

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
