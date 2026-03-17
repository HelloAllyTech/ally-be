import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  BadgeViewedStatus,
  BadgeCategory,
  BadgeStatus,
} from '../constants/badge.constants';
import { BadgeService } from '../service/badge.service';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  CreateBadgeDto,
  CreateBadgeResponseDto,
  CreateBadgesBatchDto,
  CreateBadgesBatchResponseDto,
  DeleteBadgesBatchDto,
  UpdateBadgeDto,
} from '../dto/badge.dto';
import {
  UserBadgeResponseDto,
  UserBadgeCountResponseDto,
  GroupedUserAvailableBadgesDto,
  MarkBadgeViewedResponseDto,
  AdminBadgeListResponseDto,
  TenantBadgeListResponseDto,
} from '../dto/user-badge-response.dto';
import { BadgeTenantService } from '../service/badge-tenant.service';
import { AddBadgeToTenantsRequestDto } from '../dto/badge-tenant.dto';
import { BadgeImageUploadRequestDto } from '../dto/badge-image-upload-request.dto';
import { BadgeImageUploadResponseDto } from '../dto/badge-image-upload-response.dto';
import { DeleteBadgeImageDto } from '../dto/delete-badge-image.dto';
import { BadgeFilterDto } from '../dto/badge-filter.dto';
import { SortOrder } from 'src/common/type/common.type';
import { BadgeSortBy } from '../enum/badge-sort-by.enum';

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

  @ApiOperation({ summary: 'Create a badge' })
  @ApiResponse({
    status: 201,
    description: 'Badge created successfully',
    type: CreateBadgeResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Post()
  async createBadge(
    @Body() createBadgeDto: CreateBadgeDto,
  ): Promise<CreateBadgeResponseDto> {
    return this.badgeService.createBadge(createBadgeDto);
  }

  @ApiOperation({ summary: 'Create badges in batch' })
  @ApiBody({ type: CreateBadgesBatchDto })
  @ApiResponse({
    status: 201,
    description: 'Badges created successfully',
    type: CreateBadgesBatchResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Post('/batch')
  async createBadgesBatch(
    @Body() createBadgesBatchDto: CreateBadgesBatchDto,
  ): Promise<CreateBadgesBatchResponseDto> {
    return this.badgeService.createBadgesBatch(createBadgesBatchDto);
  }

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
    return this.badgeService.getUserBadges(tokenUser.id, viewedStatus, true);
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
  @Get('me/count')
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
  @Get('me/available')
  async getAvailableBadges(
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<GroupedUserAvailableBadgesDto[]> {
    return this.badgeService.getFormattedUserAvailableBadges(tokenUser.id);
  }

  @ApiOperation({ summary: 'Mark a badge as viewed for the current user' })
  @ApiParam({
    name: 'badgeId',
    type: String,
    description: 'The ID of the badge to mark as viewed',
  })
  @ApiResponse({
    status: 200,
    description: 'Badge marked as viewed successfully',
    type: MarkBadgeViewedResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Badge not found for user',
  })
  @AuthPermissions([PERMISSIONS.EDIT_USER_BADGES])
  @Patch('me/:badgeId/viewed')
  async markBadgeAsViewed(
    @CurrentUser() tokenUser: TokenUser,
    @Param('badgeId', ParseUUIDPipe) badgeId: string,
  ): Promise<MarkBadgeViewedResponseDto> {
    return this.badgeService.markBadgeAsViewed(tokenUser.id, badgeId);
  }

  @ApiOperation({ summary: 'Get all badges (Admin)' })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  @ApiQuery({
    name: 'search',
    type: String,
    required: false,
    description: 'Search by name (case-insensitive)',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: BadgeCategory,
    description: 'Filter by badge category',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: BadgeStatus,
    description: 'Filter by badge status',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: BadgeSortBy,
    description: 'Sort column',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns all badges in the system',
    type: AdminBadgeListResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_BADGES])
  @Get()
  async getAllBadges(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
    @Query('category') category?: BadgeCategory,
    @Query('status') status?: BadgeStatus,
    @Query('sortBy') sortBy: BadgeSortBy = BadgeSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<AdminBadgeListResponseDto> {
    const filter: BadgeFilterDto = { search, category, status };
    return this.badgeService.getAllBadges(
      { limit, offset, sortBy, order },
      filter,
    );
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

  @ApiOperation({ summary: 'Get badges assigned to a specific tenant' })
  @ApiParam({
    name: 'tenantId',
    type: String,
    description: 'The ID of the tenant',
  })
  @ApiQuery({ name: 'limit', type: Number, required: false })
  @ApiQuery({ name: 'offset', type: Number, required: false })
  @ApiQuery({
    name: 'search',
    type: String,
    required: false,
    description: 'Search by name (case-insensitive)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: BadgeSortBy,
    description: 'Sort column',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns all badges assigned to the tenant',
    type: TenantBadgeListResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_BADGES_FOR_SETTING])
  @Get('/tenants/:tenantId')
  async getBadgesForTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('search') search?: string,
    @Query('sortBy') sortBy: BadgeSortBy = BadgeSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<TenantBadgeListResponseDto> {
    return this.badgeService.getPaginatedBadgesForTenant(tenantId, {
      limit,
      offset,
      sortBy,
      order,
      search,
    });
  }

  @ApiOperation({ summary: 'Remove badge from tenants' })
  @ApiBody({ type: AddBadgeToTenantsRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Badge removed from tenants successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Delete('/tenants')
  async removeBadgeFromTenants(
    @Body() removeBadgeFromTenantsDto: AddBadgeToTenantsRequestDto,
  ) {
    await this.badgeService.removeBadgeAndUsersFromTenants(
      removeBadgeFromTenantsDto.badgeId,
      removeBadgeFromTenantsDto.tenantIds,
    );
    return {
      message: 'Badge removed from tenants successfully',
    };
  }

  @ApiOperation({ summary: 'Get presigned URL for badge image' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Post('badge-image-url')
  async getPresignedUrlForScenarioCoverImage(
    @Body() badgeImageUploadRequestDto: BadgeImageUploadRequestDto,
  ): Promise<BadgeImageUploadResponseDto> {
    return this.badgeService.getPresignedUrlForBadgeImage(
      badgeImageUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Delete badge image' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @ApiBody({ type: DeleteBadgeImageDto })
  @Delete('badge-image')
  async deleteBadgeImage(@Body() deleteBadgeImageDto: DeleteBadgeImageDto) {
    return this.badgeService.deleteBadgeImage(deleteBadgeImageDto);
  }

  @ApiOperation({ summary: 'Update a badge' })
  @ApiParam({
    name: 'badgeId',
    type: String,
    description: 'The ID of the badge to update',
  })
  @ApiBody({ type: UpdateBadgeDto })
  @ApiResponse({
    status: 200,
    description: 'Badge updated successfully',
    type: Boolean,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Patch(':badgeId')
  async updateBadge(
    @Param('badgeId', ParseUUIDPipe) badgeId: string,
    @Body() updateBadgeDto: UpdateBadgeDto,
  ): Promise<boolean> {
    return this.badgeService.updateBadge(badgeId, updateBadgeDto);
  }

  @ApiOperation({ summary: 'Delete badges in batch' })
  @ApiResponse({
    status: 200,
    description: 'Badges deleted successfully',
    type: Boolean,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Delete('batch')
  async deleteBadgesBatch(
    @Body() deleteBadgesBatchDto: DeleteBadgesBatchDto,
  ): Promise<boolean> {
    return this.badgeService.deleteBadgesBatch(deleteBadgesBatchDto.badgeIds);
  }

  @ApiOperation({ summary: 'Delete a badge' })
  @ApiParam({
    name: 'badgeId',
    type: String,
    description: 'The ID of the badge to delete',
  })
  @ApiResponse({
    status: 200,
    description: 'Badge deleted successfully',
    type: Boolean,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_BADGES])
  @Delete(':badgeId')
  async deleteBadge(
    @Param('badgeId', ParseUUIDPipe) badgeId: string,
  ): Promise<boolean> {
    return this.badgeService.deleteBadge(badgeId);
  }
}
