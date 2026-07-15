import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RoleplaySessionService } from '../service/roleplay-session.service';
import { StartRoleplaySessionDto } from '../dto/roleplay-session.dto';

@ApiTags('Roleplay Studio Sessions')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio', version: '1' })
export class RoleplaySessionController {
  constructor(
    private readonly roleplaySessionService: RoleplaySessionService,
  ) {}

  @Post('specs/:specId/versions/:versionId/sessions')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_SPEC])
  @ApiOperation({
    summary:
      'Start a test session against a specific spec version (roleplay- room, dispatched to the merged v1+v2 worker; gated by the v2 flag + allowlist)',
  })
  startSession(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: StartRoleplaySessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.roleplaySessionService.startSpecSession(
      user.id,
      specId,
      versionId,
      dto,
    );
  }

  @Get('sessions/:sessionId/director-events')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({
    summary: 'Director telemetry for a session (transitions, unlocks, …)',
  })
  getDirectorEvents(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.roleplaySessionService.getDirectorEvents(sessionId);
  }

  @Get('sessions/:sessionId/rubric-scores')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_SPECS])
  @ApiOperation({ summary: 'Per-turn rubric scores for a session' })
  getRubricScores(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.roleplaySessionService.getRubricScores(sessionId);
  }
}
