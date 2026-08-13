import {
  Controller,
  Get,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Post,
  Body,
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
import { ApiServiceAuthGuard } from 'src/auth/decorators/api-auth.decorator';
import { ValidatePermissionsDto } from '../dto/validate-permissions.dto';
import { FEATURE_TOGGLES } from '../constants/admin-feature-toggle.constants';

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

  @ApiOperation({ summary: 'Validate permissions' })
  @ApiServiceAuthGuard()
  @HttpCode(HttpStatus.OK)
  @Post('/permissions/validate')
  async validatePermissions(
    @Body() validatePermissionsDto: ValidatePermissionsDto,
  ) {
    return this.permissionsService.validatePermissions(validatePermissionsDto);
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

  @ApiOperation({
    summary: 'Get the feature-toggle registry',
    description:
      'The full list of per-admin-user feature toggle keys, labels and descriptions. ' +
      'The single source of truth ally-web reads to build its admin nav and the ' +
      'Admin User Management toggle editor, instead of keeping a second, hand-mirrored copy.',
  })
  @ApiResponse({ status: 200, description: 'The feature toggle registry' })
  @HttpCode(HttpStatus.OK)
  @Get('feature-toggles/registry')
  @UseGuards(JwtAuthGuard)
  getFeatureToggleRegistry() {
    return FEATURE_TOGGLES.map(({ key, label, description }) => ({
      key,
      label,
      description,
    }));
  }
}
