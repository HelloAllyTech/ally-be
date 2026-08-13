import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PlatformAdminService } from '../service/platform-admin.service';
import {
  AssignPlatformAdminDto,
  PlatformAdminListResponseDto,
} from '../dto/platform-admin.dto';
import { SuccessResponse } from 'src/common/type/common.type';

/**
 * Management of the consolidated PLATFORM_ADMIN role — who holds it at all.
 * Fine-grained access (which of the ~21 formerly tier-gated surfaces a given
 * platform admin can reach) is managed separately via
 * GET/PATCH /v1/users/:userId/feature-toggles. Every endpoint here requires
 * the admin_user_management toggle, same as the toggle-editor endpoints.
 */
@Controller('v1/platform-admins')
@ApiTags('Platform Admins')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @ApiOperation({ summary: 'List all platform admins' })
  @ApiResponse({ status: 200, type: PlatformAdminListResponseDto })
  @ApiQuery({ name: 'search', required: false, type: String })
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @Get()
  listPlatformAdmins(
    @Query('search') search?: string,
  ): Promise<PlatformAdminListResponseDto> {
    return this.platformAdminService.listPlatformAdmins(search);
  }

  @ApiOperation({
    summary: 'List users eligible to become platform admins',
  })
  @ApiResponse({ status: 200, type: PlatformAdminListResponseDto })
  @ApiQuery({ name: 'search', required: false, type: String })
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @Get('eligible')
  listEligibleUsers(
    @Query('search') search?: string,
  ): Promise<PlatformAdminListResponseDto> {
    return this.platformAdminService.listEligibleUsers(search);
  }

  @ApiOperation({ summary: 'Assign the platform admin role to a user' })
  @ApiResponse({ status: 201, description: 'User assigned' })
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @Post()
  assign(
    @Body() dto: AssignPlatformAdminDto,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.platformAdminService.assign(dto, tokenUser.id);
  }

  @ApiOperation({
    summary:
      'Remove the platform admin role from a user. Self-removal and removing the last remaining platform admin are rejected.',
  })
  @ApiResponse({ status: 200, description: 'Platform admin role removed' })
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  @Delete(':userId')
  remove(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    return this.platformAdminService.remove(userId, tokenUser.id);
  }
}
