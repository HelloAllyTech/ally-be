import {
  Controller,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Post,
  Body,
  Delete,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { PermissionsService } from '../service/permissions.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../constants/permissions.constants';
import { ChangeUserRolesDto } from 'src/user/dto/group.dto';
import { GroupService } from '../service/group.service';
import {
  CreatePermissionDto,
  DeletePermissionDto,
  DeletePermissionGroupsDto,
  GrantPermissionToRolesDto,
} from '../dto/permissions.dto';

@ApiTags('Authorization')
@Controller('v1/authorization')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AuthorizationController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly groupService: GroupService,
  ) {}

  @Get('permissions')
  @ApiOperation({ summary: 'Get current user permissions' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved user permissions',
    schema: {
      type: 'array',
      items: { type: 'string' },
    },
  })
  @UseGuards(JwtAuthGuard)
  async getPermissions(@Req() req: { user: { id: string } }) {
    return await this.permissionsService.getUserPermissions(
      parseInt(req.user.id),
    );
  }

  @ApiOperation({
    summary: 'Change user roles',
    description:
      'Update user roles by adding new ones and removing those not in the list',
  })
  @ApiResponse({
    status: 200,
    description: 'User roles updated successfully',
    schema: {
      example: {
        success: true,
        message: 'User roles updated successfully.',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Invalid input or operation failed',
  })
  @ApiResponse({
    status: 404,
    description: 'User or one or more roles not found',
  })
  @HttpCode(HttpStatus.OK)
  @Post('change-roles')
  @AuthPermissions([PERMISSIONS.EDIT_USER_ROLE])
  async changeUserRoles(@Body() changeUserRolesDto: ChangeUserRolesDto) {
    return this.groupService.changeUserRoles(changeUserRolesDto);
  }

  @ApiOperation({ summary: 'get all roles' })
  @ApiResponse({
    status: 200,
    description: 'List of all roles',
  })
  @HttpCode(HttpStatus.OK)
  @Get('roles')
  @AuthPermissions([PERMISSIONS.VIEW_USER_ROLES])
  async getAllRoles() {
    return this.groupService.getAllRoles();
  }

  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({ status: 201, description: 'Permission created successfully' })
  @AuthPermissions([PERMISSIONS.EDIT_PERMISSION])
  @Post('permission')
  async createPermission(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionsService.createPermission(createPermissionDto);
  }

  @ApiOperation({ summary: 'Grant a permission to a role' })
  @ApiResponse({
    status: 201,
    description: 'Permission successfully granted to role',
  })
  @AuthPermissions([PERMISSIONS.EDIT_GROUPS_PERMISSION])
  @Post('grant-permission')
  async grantPermissionToRoles(
    @Body() grantPermissionToRolesDto: GrantPermissionToRolesDto,
  ) {
    return this.permissionsService.grantPermissionToRoles(
      grantPermissionToRolesDto,
    );
  }

  @ApiOperation({
    summary: 'Delete a permission and its associated group permissions',
  })
  @ApiResponse({ status: 200, description: 'Permission deleted successfully' })
  @AuthPermissions([PERMISSIONS.DELETE_PERMISSION])
  @Delete('permission')
  async deletePermission(@Body() deletePermissionDto: DeletePermissionDto) {
    return await this.permissionsService.deletePermission(deletePermissionDto);
  }

  @ApiOperation({
    summary: 'Delete group permissions',
  })
  @ApiResponse({
    status: 200,
    description: 'Group permissions deleted successfully',
  })
  @Delete('permission-groups')
  @AuthPermissions([PERMISSIONS.DELETE_GROUPS_PERMISSION])
  async deleteGroupPermission(
    @Body() deletePermissionGroupsDto: DeletePermissionGroupsDto,
  ) {
    return await this.permissionsService.deletePermissionGroups(
      deletePermissionGroupsDto,
    );
  }
}
