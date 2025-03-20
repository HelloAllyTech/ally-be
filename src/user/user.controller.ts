import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/user.decorator';
import { TokenUser } from '../auth/type/auth.types';
import { UserService } from './user.service';

@Controller('v1/users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() tokenUser: TokenUser) {
    const user = await this.userService.get(tokenUser.id);
    if (!user) {
      return null;
    }
    return this.userService.getMinimalUserInfo(user);
  }

  @Get('waiting-list')
  getWaitingList() {
    return this.userService.getWaitingList();
  }
}
