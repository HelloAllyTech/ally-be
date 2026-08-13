import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import {
  BugHunterSettingsDto,
  BugHuntEventDto,
  BugHuntRunDetailDto,
  BugHuntRunDto,
  ListBugHuntRunsResponseDto,
  UpdateBugHunterSettingsDto,
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
  constructor(private readonly bugHunterService: BugHunterService) {}

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
    summary: 'Flip the kill switch (super-duper-admin)',
    description:
      'OFF blocks every trigger — nightly and on-demand alike — until turned ' +
      'back on. The flip itself is logged to the same event timeline as run ' +
      'activity.',
  })
  @ApiResponse({ status: 200, type: BugHunterSettingsDto })
  async updateSettings(
    @Body() body: UpdateBugHunterSettingsDto,
    @CurrentUser() user: TokenUser,
  ): Promise<BugHunterSettingsDto> {
    return toSettingsDto(
      await this.bugHunterService.setEnabled(body.enabled, user.id),
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
    enabled: row.enabled,
    updatedBy: row.updatedBy ?? null,
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
    createdAt: row.createdAt,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
