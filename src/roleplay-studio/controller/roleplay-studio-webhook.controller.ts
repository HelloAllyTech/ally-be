import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { RoleplaySessionService } from '../service/roleplay-session.service';

/**
 * Machine-to-machine endpoints for the roleplay v2 agent (x-api-key guarded).
 * The room-metadata `specFetch.url` points here when the compiled spec is too
 * large to inline (>= 55KB serialized).
 */
@Controller({ path: 'roleplay-studio/webhook', version: '1' })
@ApiTags('Roleplay Studio Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class RoleplayStudioWebhookController {
  constructor(
    private readonly roleplaySessionService: RoleplaySessionService,
  ) {}

  @Get('spec-versions/:versionId')
  @ApiOperation({
    summary: 'Fetch the compiled runtime spec for a version (API key only)',
  })
  getSpecVersion(@Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.roleplaySessionService.getCompiledSpecVersion(versionId);
  }
}
