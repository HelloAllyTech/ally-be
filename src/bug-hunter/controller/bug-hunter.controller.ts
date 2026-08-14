import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';

import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { SUPER_DUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';

import { BugHunterService } from '../service/bug-hunter.service';
import { BugFindingService } from '../service/bug-finding.service';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugFinding } from '../entity/bug-finding.entity';
import {
  BugHunterSettingsDto,
  BugHuntEventDto,
  BugHuntRunDetailDto,
  BugHuntRunDto,
  BugFindingDto,
  BugFindingDetailDto,
  ListBugHuntRunsResponseDto,
  ListBugFindingsQueryDto,
  ListBugFindingsResponseDto,
  UpdateBugHunterSettingsDto,
  AnswerBugFindingDto,
} from '../dto/bug-hunter.dto';
import {
  BUG_HUNT_SSE_PING_INTERVAL_MS,
  BUG_HUNT_SSE_POLL_INTERVAL_MS,
} from '../constants/bug-hunter.constants';

/**
 * The Bug Hunter HUMAN admin surface — settings (kill switch), run history,
 * and a live event stream. Gated `@RequireFeatureToggle`, same tier as
 * Analytics Suggestions: this controls something that writes into repos and
 * other teams' backlogs, not a fixed reviewed chart.
 *
 * The pipeline's own start/report/close calls live in
 * `BugHunterPipelineController` instead — `@RequireFeatureToggle` runs
 * `AuthGuard('jwt')` first, which requires a logged-in human, and the
 * `.claude/workflows/bug-hunt.mjs` pipeline is a machine caller with no user
 * session. Splitting the controller (not the module) keeps both auth models
 * on their own routes without mixing guards per-method.
 */
@ApiTags('Bug Hunter')
@Controller('v1/bug-hunter')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class BugHunterController {
  constructor(
    private readonly bugHunterService: BugHunterService,
    private readonly bugFindingService: BugFindingService,
  ) {}

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({ summary: 'Read the kill switch (super-duper-admin)' })
  @ApiResponse({ status: 200, type: BugHunterSettingsDto })
  async getSettings(): Promise<BugHunterSettingsDto> {
    return toSettingsDto(await this.bugHunterService.getSettings());
  }

  @Patch('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Change the kill switch mode (super-duper-admin)',
    description:
      'OFF blocks every trigger — nightly and on-demand alike — until moved ' +
      'off OFF. MANUAL and AI both let discovery run; only MANUAL gates the ' +
      'fix stage on an admin approving each finding first. The change itself ' +
      'is logged to the same event timeline as run activity.',
  })
  @ApiResponse({ status: 200, type: BugHunterSettingsDto })
  async updateSettings(
    @Body() body: UpdateBugHunterSettingsDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugHunterSettingsDto> {
    return toSettingsDto(
      await this.bugHunterService.setMode(body.mode, user.id),
    );
  }

  @Get('findings')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'The comprehensive bug table — every bug Bug Hunter knows about, from any source (super-duper-admin)',
    description:
      'Newest first. Defaults to every status; pass `status` to filter to one, ' +
      'or `all` explicitly. A human-reported bug appears here from the moment ' +
      "it's filed, even before any hunt run has triaged it.",
  })
  @ApiResponse({ status: 200, type: ListBugFindingsResponseDto })
  async listFindings(
    @Query() query: ListBugFindingsQueryDto,
  ): Promise<ListBugFindingsResponseDto> {
    const { items, count } = await this.bugFindingService.list({
      status: query.status && query.status !== 'all' ? query.status : undefined,
      source: query.source,
      repo: query.repo,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
    return { items: items.map(toFindingDto), count };
  }

  @Get('findings/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'One finding plus its event timeline, for the drawer (super-duper-admin)',
  })
  @ApiResponse({ status: 200, type: BugFindingDetailDto })
  async getFinding(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BugFindingDetailDto> {
    const finding = await this.bugFindingService.getOne(id);
    const events = await this.bugHunterService.listEventsForFinding(id);
    return { ...toFindingDto(finding), events: events.map(toEventDto) };
  }

  @Post('findings/:id/approve')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'Approve a Manual-mode finding for fixing (super-duper-admin)',
    description:
      'Only valid from PENDING_APPROVAL. The next hunt run for that repo — ' +
      'scheduled or on-demand — picks up every APPROVED finding in its Fix ' +
      'phase; this does not trigger a run itself.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async approveFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return toFindingDto(await this.bugFindingService.approve(id, user.id));
  }

  @Post('findings/:id/reject')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      'Decline to fix a finding — it will never be picked up (super-duper-admin)',
    description:
      'Valid from NEW or PENDING_APPROVAL. Terminal: rejected findings never re-enter the pipeline.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async rejectFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return toFindingDto(await this.bugFindingService.reject(id, user.id));
  }

  @Post('findings/:id/answer')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: "Answer a finding's open escalation question (super-duper-admin)",
    description:
      'Only valid while the finding is NEEDS_INPUT. The fix agent may be ' +
      'actively polling for this (it waits up to a bounded timeout before ' +
      "giving up for now) — answering doesn't itself change the status; the " +
      'pipeline transitions it once it reads the answer.',
  })
  @ApiResponse({ status: 200, type: BugFindingDto })
  async answerFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AnswerBugFindingDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugFindingDto> {
    return toFindingDto(
      await this.bugFindingService.recordAnswer(id, body.answer, user.id),
    );
  }

  @Get('runs')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({ summary: 'Run history, newest first (super-duper-admin)' })
  @ApiResponse({ status: 200, type: ListBugHuntRunsResponseDto })
  async listRuns(
    @Query('limit') limit?: string,
  ): Promise<ListBugHuntRunsResponseDto> {
    const runs = await this.bugHunterService.listRuns(
      limit ? Number(limit) : undefined,
    );
    return { items: runs.map(toRunDto) };
  }

  @Get('runs/:id')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary: 'One run plus its full event timeline (super-duper-admin)',
  })
  @ApiResponse({ status: 200, type: BugHuntRunDetailDto })
  async getRun(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BugHuntRunDetailDto> {
    const { run, events } = await this.bugHunterService.getRunWithEvents(id);
    return { ...toRunDto(run), events: events.map(toEventDto) };
  }

  @Get('runs/:id/stream')
  @RequireFeatureToggle(FeatureToggleKey.BUG_HUNTER, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
  })
  @ApiOperation({
    summary:
      "Live event stream for one run (SSE: event / ping), for the admin tab's live run card",
  })
  async streamRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let clientGone = false;
    res.on('close', () => {
      clientGone = true;
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    // No in-process emitter exists — the pipeline runs as an external agent
    // and reports over POST /report — so this is a poll loop over
    // BugHuntEvent, not a subscription. Cheap: one run's event count is small
    // and the interval is a few seconds, matching the copilot stream's ping
    // cadence for a familiar feel in the admin tab.
    let cursor = new Date(0);

    while (!clientGone) {
      const events = await this.bugHunterService.listEventsSince(id, cursor);
      for (const event of events) {
        safeWrite('event', toEventDto(event));
        cursor = event.createdAt;
      }

      const run = await this.bugHunterService.getRun(id);
      if (run.status !== 'running') {
        safeWrite('done', { status: run.status });
        break;
      }

      safeWrite('ping', { at: new Date().toISOString() });
      await sleep(
        events.length
          ? BUG_HUNT_SSE_PING_INTERVAL_MS
          : BUG_HUNT_SSE_POLL_INTERVAL_MS,
      );
    }

    if (!res.writableEnded) res.end();
  }
}

export function toSettingsDto(row: BugHunterSettings): BugHunterSettingsDto {
  return {
    mode: row.mode,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt,
  };
}

export function toFindingDto(row: BugFinding): BugFindingDto {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    source: row.source,
    title: row.title,
    description: row.description,
    file: row.file ?? null,
    evidence: row.evidence ?? null,
    severity: row.severity ?? null,
    proven: row.proven,
    touchesGuardedPath: row.touchesGuardedPath,
    reportedBugId: row.reportedBugId ?? null,
    status: row.status,
    prUrl: row.prUrl ?? null,
    escalationQuestion: row.escalationQuestion ?? null,
    escalationAnswer: row.escalationAnswer ?? null,
    escalationAnsweredBy: row.escalationAnsweredBy ?? null,
    escalationAnsweredAt: row.escalationAnsweredAt ?? null,
    decidedBy: row.decidedBy ?? null,
    decidedAt: row.decidedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toRunDto(row: BugHuntRun): BugHuntRunDto {
  return {
    id: row.id,
    trigger: row.trigger,
    repo: row.repo,
    status: row.status,
    finishedAt: row.finishedAt ?? null,
    foundCount: row.foundCount,
    autoMergedCount: row.autoMergedCount,
    prOpenedCount: row.prOpenedCount,
    dismissedCount: row.dismissedCount,
    totalTokenCostUsd: row.totalTokenCostUsd,
    createdAt: row.createdAt,
  };
}

export function toEventDto(row: BugHuntEvent): BugHuntEventDto {
  return {
    id: row.id,
    runId: row.runId ?? null,
    repo: row.repo ?? null,
    stage: row.stage,
    summary: row.summary,
    payload: row.payload ?? null,
    suggestionId: row.suggestionId ?? null,
    findingId: row.findingId ?? null,
    createdAt: row.createdAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
