import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { ChangeUserRolesDto } from 'src/user/dto/group.dto';
import { GroupService } from '../service/group.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../constants/permissions.constants';

@ApiTags('User Groups')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/user-groups')
export class UserGroupController {
  constructor(private readonly groupService: GroupService) {}

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
  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_USER_ROLES])
  async getAllRoles() {
    return this.groupService.getAllRoles();
  }
}
