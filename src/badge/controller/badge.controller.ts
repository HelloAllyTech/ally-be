import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { BadgeViewedStatus } from '../constants/badge.constants';
import { BadgeService } from '../service/badge.service';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  UserBadgeResponseDto,
  UserBadgeCountResponseDto,
  GroupedUserAvailableBadgesDto,
} from '../dto/user-badge-response.dto';
import { BadgeTenantService } from '../service/badge-tenant.service';
import { AddBadgeToTenantsRequestDto } from '../dto/badge-tenant.dto';

@ApiTags('Badge')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'badges',
  version: '1',
})
export class BadgeController {
  constructor(
    private readonly badgeService: BadgeService,
    private readonly badgeTenantService: BadgeTenantService,
  ) {}

  @ApiOperation({ summary: 'Get all badges for the current user' })
  @ApiQuery({
    name: 'viewedStatus',
    required: false,
    enum: BadgeViewedStatus,
    description: 'Filter by viewed status (VIEWED or UNVIEWED)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns the list of badges awarded to the user in the recent first order',
    type: UserBadgeResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_USER_BADGES])
  @Get('/me')
  async getMyBadges(
    @CurrentUser() tokenUser: TokenUser,
    @Query('viewedStatus') viewedStatus?: BadgeViewedStatus,
  ): Promise<UserBadgeResponseDto> {
    return this.badgeService.getUserBadges(tokenUser.id, viewedStatus);
  }

  @ApiOperation({ summary: 'Get count of badges awarded to the current user' })
  @ApiQuery({
    name: 'viewedStatus',
    required: false,
    enum: BadgeViewedStatus,
    description: 'Filter by viewed status (VIEWED or UNVIEWED)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the count of badges awarded to the user',
    type: UserBadgeCountResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_USER_BADGES])
  @Get('count')
  async getMyBadgeCount(
    @CurrentUser() tokenUser: TokenUser,
    @Query('viewedStatus') viewedStatus?: BadgeViewedStatus,
  ): Promise<UserBadgeCountResponseDto> {
    const count = await this.badgeService.getUserBadgeCount(
      tokenUser.id,
      viewedStatus,
    );
    return { count };
  }

  @ApiOperation({
    summary:
      'Get all available badges for the current user grouped by category',
  })
  @ApiResponse({
    status: 200,
    description:
      'Returns all badges available for the tenant, grouped by category and sorted by achievement count',
    type: [GroupedUserAvailableBadgesDto],
  })
  @AuthPermissions([PERMISSIONS.VIEW_USER_BADGES])
  @Get('available')
  async getAvailableBadges(
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<GroupedUserAvailableBadgesDto[]> {
    return this.badgeService.getFormattedUserAvailableBadges(tokenUser.id);
  }

  @ApiOperation({ summary: 'Add badge to tenants' })
  @ApiBody({ type: AddBadgeToTenantsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Badge added to tenants successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Post('/tenants')
  async addBadgeToTenants(
    @Body() addBadgeToTenantsDto: AddBadgeToTenantsRequestDto,
  ) {
    await this.badgeTenantService.addBadgeToTenants(
      addBadgeToTenantsDto.badgeId,
      addBadgeToTenantsDto.tenantIds,
    );
    return {
      message: 'Badge added to tenants successfully',
    };
  }
}
