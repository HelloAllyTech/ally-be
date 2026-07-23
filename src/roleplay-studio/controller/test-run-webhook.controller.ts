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
import { RoleplayTestRunService } from '../service/roleplay-test-run.service';
import { UpdateTestRunWebhookDto } from '../dto/roleplay-test-run.dto';

/**
 * ai-learn → ally-be test-run progress webhook (x-api-key guarded).
 * FROZEN path: PATCH /v1/roleplay-studio/test-runs/webhook/:runId — must
 * match ai-learn's ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT (incl. the global
 * /api prefix it prepends).
 */
@Controller({ path: 'roleplay-studio/test-runs/webhook', version: '1' })
@ApiTags('Roleplay Studio Test Run Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class TestRunWebhookController {
  constructor(private readonly testRunService: RoleplayTestRunService) {}

  @Patch(':runId')
  @ApiOperation({
    summary: 'Update a test run (status/progress/results/per-case transcripts)',
  })
  updateTestRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: UpdateTestRunWebhookDto,
  ) {
    return this.testRunService.updateFromWebhook(runId, dto);
  }
}
