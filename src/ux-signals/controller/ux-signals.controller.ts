import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';

import {
  ListUxScansQueryDto,
  ListUxScansResponseDto,
  UxScanOutcomeDto,
} from '../dto/ux-signals.dto';
import { UxSignalScanTrigger } from '../enum/ux-signal.enum';
import { UxSignalsService } from '../service/ux-signals.service';

/**
 * The UX Signals surface: run a scan on demand, and read what past scans did.
 *
 * Two endpoints and no decision endpoints, deliberately. A scan's *output* is
 * reviewed where the rest of that queue's work already is — bugs in Bug Hunter,
 * suggestions in the Analytics Suggestions tab — so there is no third review UI
 * to learn and no second approve/reject flow to keep consistent with the first.
 * This controller only starts scans and reports on them.
 *
 * Gated on the UX_SIGNALS feature toggle, at the same role tier as the rest of
 * `/v1/analytics`. No new permission constant: the gate is a toggle plus a role
 * tier, so there is no `permissions` row to grant and no Redis permission cache to
 * bust on deploy.
 */
@ApiTags('UX Signals')
@Controller('v1/ux-signals')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class UxSignalsController {
  constructor(private readonly uxSignalsService: UxSignalsService) {}

  @Post('scan')
  @RequireFeatureToggle(FeatureToggleKey.UX_SIGNALS)
  @ApiOperation({
    summary: 'Scan PostHog telemetry for UX bugs and improvement opportunities',
    description:
      'Runs every detector over the last seven days of telemetry, sends what crossed ' +
      'a threshold to the model for clustering and classification, and files the ' +
      'result into the two existing review queues: bug-shaped items become Bug Hunter ' +
      'findings at NEW, improvement-shaped ones become pending Analytics Suggestions.\n\n' +
      'NOTHING IS ACTIONED AUTOMATICALLY. No fix session is dispatched and no roadmap ' +
      'opportunity is filed — both remain human decisions behind their existing gates.\n\n' +
      'SYNCHRONOUS AND SLOW: the detector queries plus one triage call take up to about ' +
      'two minutes. Clients should show a bounded progress narrative rather than a spinner.\n\n' +
      'ZERO COUNTS ACROSS THE BOARD IS A SUCCESSFUL RESULT — it means the week was quiet. ' +
      'A high `skippedDuplicates` with no new rows is also success: everything found was ' +
      'already known. `failedDetectors` names any detector whose query could not run.\n\n' +
      'The scheduled scan runs at most once every 24 hours; this endpoint ignores that ' +
      'cadence but still refuses while another scan is genuinely in flight.',
  })
  @ApiResponse({
    status: 201,
    description: 'The scan completed (possibly filing nothing)',
    type: UxScanOutcomeDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Another scan is already running',
  })
  @ApiResponse({
    status: 503,
    description:
      'PostHog query access is not configured, PostHog was unreachable, or the ' +
      'triage model returned unreadable output. Nothing was filed.',
  })
  async scan(@Req() req: { user: { id: number } }): Promise<UxScanOutcomeDto> {
    return this.uxSignalsService.runScan(
      UxSignalScanTrigger.MANUAL,
      req.user.id,
    );
  }

  @Get('scans')
  @RequireFeatureToggle(FeatureToggleKey.UX_SIGNALS)
  @ApiOperation({
    summary: 'List recent scans',
    description:
      'Newest first. `startedBy` is null for scheduled runs. A FAILED row keeps its ' +
      'error, so a scan that went wrong is visible here rather than only in the logs.',
  })
  @ApiResponse({ status: 200, type: ListUxScansResponseDto })
  async listScans(
    @Query() query: ListUxScansQueryDto,
  ): Promise<ListUxScansResponseDto> {
    return { scans: await this.uxSignalsService.listScans(query.limit) };
  }
}
