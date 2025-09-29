import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { PermissionsService } from '../service/permissions.service';

@ApiTags('Authorization')
@Controller('v1/authorization')
@ApiBearerAuth()
export class AuthorizationController {
  constructor(private readonly permissionsService: PermissionsService) {}

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
}
