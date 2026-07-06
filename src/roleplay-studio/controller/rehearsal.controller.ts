import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { RehearsalService } from '../service/rehearsal.service';
import { CreateRehearsalDto } from '../dto/rehearsal.dto';

@ApiTags('Roleplay Studio Rehearsals')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio', version: '1' })
export class RehearsalController {
  constructor(private readonly rehearsalService: RehearsalService) {}

  @Post('specs/:specId/versions/:versionId/rehearsals')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary:
      'Start an automated rehearsal of a spec version (one non-terminal run per version)',
  })
  createRehearsal(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: CreateRehearsalDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.rehearsalService.createRehearsal(
      specId,
      versionId,
      dto,
      user.id,
    );
  }

  @Get('specs/:specId/rehearsals')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary: 'List rehearsals for a spec (?versionId=… filters)',
  })
  listRehearsals(
    @Param('specId', ParseUUIDPipe) specId: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.rehearsalService.listRehearsals(specId, versionId);
  }

  @Get('rehearsals/:rehearsalId')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'Get one rehearsal run' })
  getRehearsal(@Param('rehearsalId', ParseUUIDPipe) rehearsalId: string) {
    return this.rehearsalService.getRehearsal(rehearsalId);
  }

  @Get('rehearsals/:rehearsalId/transcripts')
  @AuthPermissions([PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'Simulated-trainee transcripts (one per profile)' })
  getTranscripts(@Param('rehearsalId', ParseUUIDPipe) rehearsalId: string) {
    return this.rehearsalService.getTranscripts(rehearsalId);
  }

  @Post('rehearsals/:rehearsalId/cancel')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({ summary: 'Cancel an in-flight rehearsal' })
  cancelRehearsal(
    @Param('rehearsalId', ParseUUIDPipe) rehearsalId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.rehearsalService.cancelRehearsal(rehearsalId, user.id);
  }

  @Post('rehearsals/:rehearsalId/critique')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_REHEARSALS])
  @ApiOperation({
    summary:
      'LLM critique of a completed rehearsal → {proposals: [{patch, rationale, targetSection, severity}]}',
  })
  critiqueRehearsal(@Param('rehearsalId', ParseUUIDPipe) rehearsalId: string) {
    return this.rehearsalService.critiqueRehearsal(rehearsalId);
  }
}
