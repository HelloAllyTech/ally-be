import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
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
} from '../dto/user-badge-response.dto';

@ApiTags('Badge')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'badges',
  version: '1',
})
export class BadgeController {
  constructor(private readonly badgeService: BadgeService) {}

  @ApiOperation({ summary: 'Get all badges for the current user' })
  @ApiQuery({
    name: 'viewedStatus',
    required: false,
    enum: BadgeViewedStatus,
    description: 'Filter by viewed status (VIEWED or UNVIEWED)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of badges awarded to the user',
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
}
