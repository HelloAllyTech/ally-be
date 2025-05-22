import { Controller, Get, Body, UseGuards, Patch, Put } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { SettingsService } from '../service/settings.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';

@ApiTags('Settings')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @Get('summary-fields')
  @ApiOperation({ summary: 'Get summary fields' })
  @ApiResponse({
    status: 200,
    description: 'Returns the summary fields configuration',
    type: [String],
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  getSummaryFields() {
    return this.service.getSummaryFieldsConfig();
  }

  @Put('summary-fields')
  @ApiOperation({ summary: 'Update summary fields' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenFields: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Summary fields updated successfully',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  updateSummaryFields(@Body() body: { hiddenFields: string[] }) {
    return this.service.updateSummaryFields(body.hiddenFields);
  }

  @Get('nudge-status')
  @ApiOperation({ summary: 'Get nudge status' })
  @ApiResponse({
    status: 200,
    description: 'Returns the nudge status',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  getNudgeStatus() {
    return this.service.getNudgeStatus();
  }

  @Put('nudge-status')
  @ApiOperation({ summary: 'Update nudge status' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        status: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Nudge status updated successfully',
  })
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }
}
