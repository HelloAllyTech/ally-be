import { Controller, Get, Body, Put } from '@nestjs/common';
import { SettingsService } from '../service/settings.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

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
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS])
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
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS])
  updateSummaryFields(@Body() body: { hiddenFields: string[] }) {
    return this.service.updateSummaryFields(body.hiddenFields);
  }

  @Get('nudge-status')
  @ApiOperation({ summary: 'Get nudge status' })
  @ApiResponse({
    status: 200,
    description: 'Returns the nudge status',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS])
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
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS])
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }

  @Get('chat-types')
  @ApiOperation({ summary: 'Get enabled chat types' })
  @ApiResponse({
    status: 200,
    description: 'Returns the enabled chat types',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES])
  getChatTypes() {
    return this.service.getChatTypes();
  }

  @Put('chat-types')
  @ApiOperation({ summary: 'Update hidden chat types' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hiddenChatTypes: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Hidden chat types updated successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CHAT_TYPES])
  updateHiddenChatTypes(@Body() body: { hiddenChatTypes: string[] }) {
    return this.service.updateChatTypes(body.hiddenChatTypes);
  }
}
