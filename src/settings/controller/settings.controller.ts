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

@ApiTags('Settings')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  @GetSummaryFields()
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('summary-fields')
  getSummaryFields() {
    return this.service.getSummaryFieldsConfig();
  }

  @UpdateSummaryFields()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Put('summary-fields')
  updateSummaryFields(@Body() body: { hiddenFields: string[] }) {
    return this.service.updateSummaryFields(body.hiddenFields);
  }

  @GetNudgeStatus()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Get('nudge-status')
  getNudgeStatus() {
    return this.service.getNudgeStatus();
  }

  @UpdateNudgeStatus()
  @AuthRoles(UserRole.COUNSELOR, UserRole.ADMIN)
  @Put('nudge-status')
  updateNudgeStatus(@Body() body: { status: boolean }) {
    return this.service.updateNudgeStatus(body.status);
  }

  @GetChatTypes()
  @AuthRoles(UserRole.COUNSELOR, UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @Get('chat-types')
  getChatTypes() {
    return this.service.getChatTypes();
  }

  @UpdateHiddenChatTypes()
  @AuthRoles(UserRole.ADMIN)
  @Put('chat-types')
  updateHiddenChatTypes(@Body() body: { hiddenChatTypes: string[] }) {
    return this.service.updateChatTypes(body.hiddenChatTypes);
  }
}
