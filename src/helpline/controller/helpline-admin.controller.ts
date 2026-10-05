import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  AdminSettingsQueryDto,
  UpdateAdminSettingsDto,
} from '../dto/helpline.dto';
import { HelplineAdminService } from '../service/helpline-admin.service';
import { AdminSettingsDto, HelplineStaffUser } from '../type/helpline.types';

/**
 * Admin console → Organization → Text helpline (contract §5.4). Platform
 * admins only (`EDIT_GLOBAL_SETTINGS`); per-tenant settings live in the admin
 * console since 2026-09-30. Not behind `@RequireHelplineEnabled()` — this is
 * where the helpline gets switched on.
 */
@ApiTags('Text helpline — admin')
@ApiBearerAuth()
@Controller({ path: 'helpline/admin', version: '1' })
export class HelplineAdminController {
  constructor(private readonly admin: HelplineAdminService) {}

  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  @Get('settings')
  @ApiOperation({ summary: "An organisation's helpline switch and settings" })
  getSettings(
    @CurrentUser() user: HelplineStaffUser,
    @Query() query: AdminSettingsQueryDto,
  ): Promise<AdminSettingsDto> {
    return this.admin.getSettings(user, query.tenantId);
  }

  @AuthPermissions([PERMISSIONS.EDIT_GLOBAL_SETTINGS])
  @Put('settings')
  @ApiOperation({
    summary: 'Turn the helpline on/off and change settings (partial)',
  })
  updateSettings(
    @CurrentUser() user: HelplineStaffUser,
    @Body() body: UpdateAdminSettingsDto,
  ): Promise<AdminSettingsDto> {
    return this.admin.updateSettings(user, body);
  }
}
