import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
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
  UxScanStartedDto,
  UxSignalScanDto,
} from '../dto/ux-signals.dto';
import { UxSignalScan } from '../entity/ux-signal-scan.entity';
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
      'ASYNCHRONOUS: this returns 202 as soon as the scan row is claimed, and the work ' +
      'continues in the background. The run takes minutes — seven sequential detector ' +
      'queries plus one triage call — which is far longer than any gateway will hold a ' +
      'connection open, so there is no synchronous result to wait for. Poll ' +
      'GET /v1/ux-signals/scans and match on the returned `scanId`: it reaches ' +
      '`completed` with its counts, or `failed` with its reason.\n\n' +
      'ZERO COUNTS ACROSS THE BOARD IS A SUCCESSFUL RESULT — it means the week was quiet. ' +
      'A high `skippedDuplicates` with no new rows is also success: everything found was ' +
      'already known. `failedDetectors` names any detector whose query could not run.\n\n' +
      'The scheduled scan runs at most once every 24 hours; this endpoint ignores that ' +
      'cadence but still refuses while another scan is genuinely in flight.',
  })
  @ApiResponse({
    status: 202,
    description:
      'The scan was claimed and is running. Poll /scans for its result.',
    type: UxScanStartedDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Another scan is already running',
  })
  @ApiResponse({
    status: 503,
    description:
      'PostHog query access is not configured, so there is nothing to scan. ' +
      'PostHog being unreachable *during* a scan is no longer a response code — ' +
      'it lands on the scan row as FAILED with its reason.',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async scan(@Req() req: { user: { id: number } }): Promise<UxScanStartedDto> {
    const scan = await this.uxSignalsService.startScan(
      UxSignalScanTrigger.MANUAL,
      req.user.id,
    );
    return {
      scanId: scan.id,
      status: scan.status,
      startedAt: scan.startedAt,
    };
  }

  @Get('scans')
  @RequireFeatureToggle(FeatureToggleKey.UX_SIGNALS)
  @ApiOperation({
    summary: 'List recent scans',
    description:
      'Newest first. `startedBy` is null for scheduled runs. A FAILED row keeps its ' +
      'error, so a scan that went wrong is visible here rather than only in the logs.\n\n' +
      'This is also how a client follows a scan it started: POST /scan returns before ' +
      'there is any result, and a row here is the only place one ever appears.',
  })
  @ApiResponse({ status: 200, type: ListUxScansResponseDto })
  async listScans(
    @Query() query: ListUxScansQueryDto,
  ): Promise<ListUxScansResponseDto> {
    const scans = await this.uxSignalsService.listScans(query.limit);
    return { scans: scans.map((scan) => this.toDto(scan)) };
  }

  /**
   * `failedDetectors` is stored inside `metadata` and lifted onto the row here.
   * Clients read a scan's outcome from this endpoint now, so a detector that could
   * not run has to be visible in the same shape as the counts — otherwise a scan
   * that found little is indistinguishable from one that could not look.
   */
  private toDto(scan: UxSignalScan): UxSignalScanDto {
    const failed = scan.metadata?.failedDetectors;
    return {
      id: scan.id,
      trigger: scan.trigger,
      status: scan.status,
      windowFrom: scan.windowFrom,
      windowTo: scan.windowTo,
      signalsDetected: scan.signalsDetected,
      findingsCreated: scan.findingsCreated,
      suggestionsCreated: scan.suggestionsCreated,
      skippedDuplicates: scan.skippedDuplicates,
      failedDetectors: Array.isArray(failed) ? failed.map(String) : [],
      error: scan.error ?? null,
      startedBy: scan.startedBy ?? null,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt ?? null,
    };
  }
}
