import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthRoles } from '../../auth/decorators/auth-roles.decorator';
import { UserRole } from '../../common/constants/user.constants';
import { RoleplaySessionLogsService } from '../service/roleplay-session-logs.service';
import {
  ListRoleplaySessionLogsQueryDto,
  ListRoleplaySessionLogsResponseDto,
  RoleplaySessionLogDetailDto,
} from '../dto/roleplay-session-logs.dto';

@ApiTags('Roleplay Session Logs')
@Controller('v1/roleplay-session-logs')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class RoleplaySessionLogsController {
  constructor(
    private readonly roleplaySessionLogsService: RoleplaySessionLogsService,
  ) {}

  @Get()
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'List all roleplay sessions across all orgs (super-admin)',
    description:
      'Platform-wide (cross-tenant) list of genuine end-user roleplay sessions ' +
      'with the user, organization, scenario, status, duration and score. ' +
      'Admin-Studio preview runs (never persisted) and local-dev seed fixtures ' +
      'are excluded. Supports search, status / org / date-range filters, sorting ' +
      'and pagination.',
  })
  @ApiResponse({ status: 200, type: ListRoleplaySessionLogsResponseDto })
  async list(
    @Query() query: ListRoleplaySessionLogsQueryDto,
  ): Promise<ListRoleplaySessionLogsResponseDto> {
    return this.roleplaySessionLogsService.list(query);
  }

  @Get(':id')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get a single roleplay session detail (super-admin)',
    description:
      'Cross-tenant detail for one roleplay session: core fields plus the ' +
      'post-session summary, scored events and full transcript.',
  })
  @ApiResponse({ status: 200, type: RoleplaySessionLogDetailDto })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleplaySessionLogDetailDto> {
    return this.roleplaySessionLogsService.getById(id);
  }
}
