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
import { User } from '../entity/user.entity';
import { SuccessResponse } from 'src/common/type/common.type';
import { UpdateUserPreferencesDto } from '../dto/update-user-prefernces.dto';

@Controller('v1/users')
@ApiTags('Users')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class UserController {
  private logger = LoggerService.getInstance(UserController.name);
  constructor(
    private userService: UserService,
    private groupService: GroupService,
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
  @AuthPermissions([PERMISSIONS.EDIT_USER])
  @ApiSecurity('access-token')
  async addUser(@Body() userData: AddUserDto): Promise<AddUserResponseDto> {
    return this.userService.addUser(userData);
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
}
