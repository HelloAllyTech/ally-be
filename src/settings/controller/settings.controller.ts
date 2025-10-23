import { Controller, Get, Body, Put } from '@nestjs/common';
import { SettingsService } from '../service/settings.service';
import { ApiTags, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import {
  GetSummaryFields,
  UpdateSummaryFields,
  GetNudgeStatus,
  UpdateNudgeStatus,
  GetChatTypes,
  UpdateHiddenChatTypes,
} from '../decorator/api-documentation.decorator';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

@ApiTags('Settings')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @GetSummaryFields()
  @Get('summary-fields')
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_SUMMARY_FIELDS])
  getSummaryFields() {
    return this.service.getSummaryFieldsConfig();
  }

  @UpdateSummaryFields()
  @Put('summary-fields')
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_SUMMARY_FIELDS])
  updateSummaryFields(@Body() body: { hiddenFields: string[] }) {
    return this.service.updateSummaryFields(body.hiddenFields);
  }

  @GetNudgeStatus()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Get('nudge-status')
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_NUDGE_STATUS])
  getNudgeStatus() {
    return this.service.getNudgeStatus();
  }

  @UpdateNudgeStatus()
  @Put('nudge-status')
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_NUDGE_STATUS])
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }

  @GetChatTypes()
  @Get('chat-types')
  @AuthPermissions([PERMISSIONS.VIEW_SETTINGS_CHAT_TYPES])
  getChatTypes() {
    return this.service.getChatTypes();
  }

  @UpdateHiddenChatTypes()
  @Put('chat-types')
  @AuthPermissions([PERMISSIONS.EDIT_SETTINGS_CHAT_TYPES])
  updateHiddenChatTypes(@Body() body: { hiddenChatTypes: string[] }) {
    return this.service.updateChatTypes(body.hiddenChatTypes);
  }
}
