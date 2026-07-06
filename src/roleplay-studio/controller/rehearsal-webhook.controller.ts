import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { RehearsalService } from '../service/rehearsal.service';
import { UpdateRehearsalWebhookDto } from '../dto/rehearsal.dto';

/**
 * ai-learn → ally-be rehearsal progress webhook (x-api-key guarded).
 * FROZEN path: PATCH /v1/roleplay-studio/rehearsals/webhook/:rehearsalId.
 */
@Controller({ path: 'roleplay-studio/rehearsals/webhook', version: '1' })
@ApiTags('Roleplay Studio Rehearsal Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class RehearsalWebhookController {
  constructor(private readonly rehearsalService: RehearsalService) {}

  @Patch(':rehearsalId')
  @ApiOperation({
    summary: 'Update a rehearsal run (status/progress/results/transcripts)',
  })
  updateRehearsal(
    @Param('rehearsalId', ParseUUIDPipe) rehearsalId: string,
    @Body() dto: UpdateRehearsalWebhookDto,
  ) {
    return this.rehearsalService.updateRehearsalFromWebhook(rehearsalId, dto);
  }
}
