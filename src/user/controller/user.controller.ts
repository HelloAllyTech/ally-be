import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { TokenUser } from '../../auth/type/auth.types';
import { UserService } from '../service/user.service';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { AssignUserRoleDto, RemoveUserRoleDto } from '../dto/group.dto';
import { GroupService } from 'src/authorization/service/group.service';
import { LoggerService } from 'src/logger/logger.service';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto';
import { UserSortBy, SortOrder } from '../enum/user.enum';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  UserListResponseDto,
  UserUpdateResponseDto,
} from '../dto/user-response.dto';
import { AddUserResponseDto } from '../dto/user-add-response.dto';
import { AddUserDto } from '../dto/add-user.dto';
import { BulkAddUsersDto } from '../dto/bulk-add-user.dto';
import { BulkAddUsersResponseDto } from '../dto/bulk-add-user-response.dto';
import { CompleteProfileDto } from '../dto/complete-profile.dto';
import { User } from '../entity/user.entity';
import { SuccessResponse } from 'src/common/type/common.type';
import { UpdateUserPreferencesDto } from '../dto/update-user-prefernces.dto';
import {
  ProfileImageUploadRequestDto,
  ProfileImageUploadResponseDto,
} from '../dto/profile-image-upload-request.dto';
import { DeleteProfileImageDto } from '../dto/delete-profile-image.dto';
import { ProfileImageUploadDto } from '../dto/profile-image-upload.dto';
import { AdminTenantService } from '../service/admin-tenant.service';
import {
  AssignAdminTenantsDto,
  RemoveAdminTenantsDto,
} from '../dto/admin-tenant.dto';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { SetFeatureTogglesDto } from 'src/authorization/dto/admin-feature-toggle.dto';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import {
  BulkSetWorkerTypeDto,
  BulkSetWorkerTypeResponseDto,
  SetWorkerTypeDto,
} from '../dto/worker-type.dto';

@Controller('v1/users')
@ApiTags('Users')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class UserController {
  private logger = LoggerService.getInstance(UserController.name);
  constructor(
    private userService: UserService,
    private groupService: GroupService,
    private adminTenantService: AdminTenantService,
    private featureToggleService: FeatureToggleService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() tokenUser: TokenUser) {
    const user = await this.userService.get(tokenUser.id);
    if (!user) {
      return null;
    }
    return this.userService.getMinimalUserInfo(user);
  }

  @ApiOperation({
    summary: "Get the current user's enabled feature toggle keys",
  })
  @Get('me/feature-toggles')
  @UseGuards(JwtAuthGuard)
  async getMyFeatureToggles(@CurrentUser() tokenUser: TokenUser) {
    return this.featureToggleService.getEnabledKeys(Number(tokenUser.id));
  }

  @ApiOperation({
    summary: "Get a platform admin's full feature toggle state",
    description:
      'Every registered key, defaulting to disabled for keys with no row yet. ' +
      'Requires the admin_user_management toggle.',
  })
  @Get(':userId/feature-toggles')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  async getFeatureTogglesForUser(
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.featureToggleService.getTogglesForUser(userId);
  }

  @ApiOperation({
    summary: "Flip one or more of a platform admin's feature toggles",
    description:
      'Batch upsert, one call per save — never a wholesale replace of the full toggle set. ' +
      'Requires the admin_user_management toggle. Rejects disabling the last remaining ' +
      'admin_user_management holder, and disabling your own.',
  })
  @Patch(':userId/feature-toggles')
  @RequireFeatureToggle(FeatureToggleKey.ADMIN_USER_MANAGEMENT)
  async setFeatureTogglesForUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: SetFeatureTogglesDto,
    @CurrentUser() tokenUser: TokenUser,
  ): Promise<SuccessResponse> {
    await this.featureToggleService.setToggles(
      userId,
      dto.toggles,
      Number(tokenUser.id),
    );
    return { success: true };
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Get('waiting-list')
  getWaitingList() {
    return this.userService.getWaitingList();
  }

  @AuthPermissions([PERMISSIONS.EDIT_USER_ROLE])
  @Post('assign-role')
  assignRole(@Body() assignUserRoleDto: AssignUserRoleDto): Promise<boolean> {
    return this.groupService.assignRole(assignUserRoleDto);
  }

  @AuthPermissions([PERMISSIONS.EDIT_USER_ROLE])
  @Delete('role')
  removeRole(@Body() removeUserRoleDto: RemoveUserRoleDto): Promise<boolean> {
    return this.groupService.removeRole(removeUserRoleDto);
  }

  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({
    status: 200,
    description: 'List of users',
    type: User,
    isArray: true,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of users to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of users to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: UserSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: SortOrder,
    description: 'Sort order: ASC or DESC',
  })
  @ApiQuery({
    name: 'tenantIds',
    required: false,
    isArray: true,
    type: String,
    description: 'Filter by tenant IDs',
  })
  @ApiQuery({
    name: 'roles',
    required: false,
    isArray: true,
    type: String,
    description: 'Filter by user roles',
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    isArray: true,
    type: String,
    description: 'Filter by user statuses',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'search by name or email',
  })
  @ApiQuery({
    name: 'includePlatformAdmins',
    required: false,
    type: Boolean,
    description:
      'Include holders of a platform role (super admin / super duper admin / internal), who are excluded by default. Requires view:super-duper-admins.',
  })
  @AuthPermissions([PERMISSIONS.VIEW_USERS])
  @Get()
  async getAllUsers(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: UserSortBy,
    @Query('sortOrder') order?: SortOrder,
    @Query('tenantIds') tenantIds?: string,
    @Query('roles') roles?: string,
    @Query('statuses') statuses?: string,
    @Query('search') search?: string,
    @Query('includePlatformAdmins') includePlatformAdmins?: string,
  ): Promise<UserListResponseDto> {
    return this.userService.getAllUsers({
      limit,
      offset,
      sortBy: sortBy || UserSortBy.CREATED_AT,
      order: order || SortOrder.DESC,
      tenantIds,
      roles,
      statuses,
      search,
      // Query params arrive as strings; only the explicit opt-in counts.
      includePlatformAdmins: includePlatformAdmins === 'true',
    });
  }

  @ApiOperation({ summary: 'Add a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created successfully',
    type: User,
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuthPermissions([PERMISSIONS.EDIT_USER, PERMISSIONS.EDIT_USER_ROLE])
  @ApiSecurity('access-token')
  async addUser(@Body() userData: AddUserDto): Promise<AddUserResponseDto> {
    return this.userService.addUser(userData);
  }

  @ApiOperation({
    summary:
      'Bulk-create users from a list of emails plus common settings. ' +
      'All-or-nothing: the batch is rejected if any email is invalid or already registered.',
  })
  @ApiResponse({
    status: 201,
    description: 'Users created successfully',
    type: BulkAddUsersResponseDto,
  })
  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @AuthPermissions([PERMISSIONS.EDIT_USER, PERMISSIONS.EDIT_USER_ROLE])
  @ApiSecurity('access-token')
  async bulkAddUsers(
    @Body() bulkData: BulkAddUsersDto,
  ): Promise<BulkAddUsersResponseDto> {
    return this.userService.bulkAddUsers(bulkData);
  }

  @ApiOperation({
    summary:
      'Complete the current user profile on first login (fill in name and ' +
      'other remaining fields for a bulk-created account)',
  })
  @Patch('me/complete-profile')
  @UseGuards(JwtAuthGuard)
  async completeProfile(
    @CurrentUser() tokenUser: TokenUser,
    @Body() body: CompleteProfileDto,
  ): Promise<SuccessResponse> {
    return this.userService.completeProfile(tokenUser.id, body);
  }

  @ApiOperation({ summary: 'upload profile image ' })
  @Patch('profile-image')
  @UseGuards(JwtAuthGuard)
  async uploadProfileImage(
    @Body() profileImageUploadDto: ProfileImageUploadDto,
  ) {
    return this.userService.uploadProfileImage(profileImageUploadDto);
  }

  @Patch(':id')
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  @ApiOperation({ summary: 'Update user details' })
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserDto,
  ): Promise<UserUpdateResponseDto> {
    return this.userService.updateUser(id, body);
  }

  @Patch('/:id/status')
  @AuthPermissions([PERMISSIONS.EDIT_USER_STATUS])
  @ApiOperation({ summary: 'Update user status' })
  async updateUserStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
  ): Promise<UserUpdateResponseDto> {
    return this.userService.updateUserStatus(id, updateUserStatusDto.status);
  }

  @ApiOperation({
    summary: 'Bulk-set worker type for a list of users',
    description:
      'One call, many user ids, one worker type — for onboarding a cohort ' +
      'of volunteers at once. All-or-nothing: rejected if any id does not ' +
      "belong to the caller's organization.",
  })
  @ApiResponse({
    status: 200,
    description: 'Users updated successfully',
    type: BulkSetWorkerTypeResponseDto,
  })
  @Patch('/worker-type/bulk')
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  async bulkSetWorkerType(
    @Body() body: BulkSetWorkerTypeDto,
  ): Promise<BulkSetWorkerTypeResponseDto> {
    return this.userService.bulkSetWorkerType(body.userIds, body.workerType);
  }

  @ApiOperation({
    summary: "Set a user's worker type",
    description:
      'Sets the clinical-experience level that gates the register of the ' +
      'AI supervisor debrief. Admin-only — learners never self-declare this.',
  })
  @ApiResponse({
    status: 200,
    description: 'User updated successfully',
    type: UserUpdateResponseDto,
  })
  @Patch('/:id/worker-type')
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  async setWorkerType(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetWorkerTypeDto,
  ): Promise<UserUpdateResponseDto> {
    return this.userService.setWorkerType(id, body.workerType);
  }

  @Get('terms-and-agreement-status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Returns the current status of terms and agreement acceptance for the authenticated user',
  })
  async getTermsAndAgreementStatus(): Promise<SuccessResponse> {
    return this.userService.getTermsAndAgreementStatus();
  }

  @Put('terms-and-agreement-status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Returns the current status of terms and agreement acceptance for the authenticated user',
  })
  async approveTermsAndAgreement(): Promise<SuccessResponse> {
    return this.userService.approveTermsAndAgreement();
  }

  @Post('/preferences')
  @ApiOperation({ summary: 'Create/Update user preferences' })
  @AuthPermissions([PERMISSIONS.EDIT_USER_PREFERENCES])
  async updateUserPreferences(
    @CurrentUser() tokenUser: TokenUser,
    @Body() body: UpdateUserPreferencesDto,
  ): Promise<UserUpdateResponseDto> {
    return this.userService.updateUserPreferences(
      tokenUser.id,
      tokenUser.tenantId,
      body,
    );
  }

  @Get('/me/preferences')
  @AuthPermissions([PERMISSIONS.VIEW_USER_PREFERENCES])
  @ApiOperation({ summary: 'Get user preferences' })
  async getUserPreferences(@CurrentUser() tokenUser: TokenUser) {
    return this.userService.getUserPreferences(tokenUser.id);
  }

  @Get('tenant')
  @AuthPermissions([PERMISSIONS.VIEW_USER_TENANT])
  @ApiOperation({ summary: 'Get tenant details of current user' })
  async getUserTenant() {
    return this.userService.getUserTenant();
  }

  @ApiOperation({ summary: 'Get presigned URL for profile image upload' })
  @UseGuards(JwtAuthGuard)
  @Post('profile-image-url')
  async getPresignedUrlForProfileImage(
    @Body() profileImageUploadRequestDto: ProfileImageUploadRequestDto,
  ): Promise<ProfileImageUploadResponseDto> {
    return this.userService.getPresignedUrlForProfileImage(
      profileImageUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Delete profile image' })
  @Delete('profile-image')
  @UseGuards(JwtAuthGuard)
  async deleteProfileImage(
    @Body() deleteProfileImageDto: DeleteProfileImageDto,
  ): Promise<SuccessResponse> {
    return this.userService.deleteProfileImage(deleteProfileImageDto);
  }

  // =====================================================================
  // Tenant allowlist — restricting a PLATFORM_ADMIN to specific tenants
  // (decision #2 of the role collapse: orthogonal to feature toggles, but
  // editing the restriction itself is gated by its own toggle).
  // =====================================================================

  @ApiOperation({
    summary: 'Restrict a platform admin to specific tenants',
  })
  @ApiResponse({ status: 200, description: 'Tenants assigned successfully' })
  @Post('admin-tenants')
  @RequireFeatureToggle(FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT, {
    permissions: [PERMISSIONS.EDIT_MULTI_TENANT_ADMINS],
  })
  async assignAdminTenants(
    @Body() dto: AssignAdminTenantsDto,
  ): Promise<SuccessResponse> {
    return this.adminTenantService.assignTenants(dto);
  }

  @ApiOperation({
    summary: 'Remove tenant restrictions from a platform admin',
  })
  @ApiResponse({ status: 200, description: 'Tenants removed successfully' })
  @Delete('admin-tenants')
  @RequireFeatureToggle(FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT, {
    permissions: [PERMISSIONS.EDIT_MULTI_TENANT_ADMINS],
  })
  async removeAdminTenants(
    @Body() dto: RemoveAdminTenantsDto,
  ): Promise<SuccessResponse> {
    return this.adminTenantService.removeTenants(dto);
  }

  @ApiOperation({
    summary: 'Get all tenants a platform admin is restricted to',
  })
  @ApiResponse({ status: 200, description: 'List of assigned tenants' })
  @Get(':userId/admin-tenants')
  @RequireFeatureToggle(FeatureToggleKey.MULTI_TENANT_ALLOWLIST_MANAGEMENT, {
    permissions: [PERMISSIONS.VIEW_MULTI_TENANT_ADMINS],
  })
  async getAdminTenants(@Param('userId', ParseIntPipe) userId: number) {
    return this.adminTenantService.getTenantsForAdmin(userId);
  }
}
