import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { TokenUser } from '../auth/type/auth.types';
import { UserService } from './user.service';
import { AuthRoles } from '../auth/decorators/auth-roles.decorator';
import { UserRole } from '../common/constants/user.constants';
import { AssignUserRoleDto, RemoveUserRoleDto } from './dto/group.dto';
import { GroupService } from 'src/authorization/service/group.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

@Controller('v1/users')
@ApiTags('Users')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class UserController {
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
}
