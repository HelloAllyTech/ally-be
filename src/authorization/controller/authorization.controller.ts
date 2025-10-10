import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GetUserPermissions } from '../decorators/api-documentation.decorators';
import { PermissionsService } from '../service/permissions.service';

@ApiTags('Authorization')
@Controller('v1/authorization')
@ApiBearerAuth()
export class AuthorizationController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @GetUserPermissions()
  @UseGuards(JwtAuthGuard)
  @Get('permissions')
  async getPermissions(@Req() req: { user: { id: string } }) {
    return await this.permissionsService.getUserPermissions(
      parseInt(req.user.id),
    );
  }
}
