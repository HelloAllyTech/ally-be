import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';

import { BugHunterService } from '../service/bug-hunter.service';
import { BugFindingService, RawFinding } from '../service/bug-finding.service';
import {
  BugHunterFinderDataService,
  ProdLogFinding,
  ReportedBugFinding,
} from '../service/bug-hunter-finder-data.service';
import {
  BugHuntRunDetailDto,
  BugHuntEventDto,
  BugFindingDto,
} from '../dto/bug-hunter.dto';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { toEventDto, toRunDto, toFindingDto } from './bug-hunter.controller';

/**
 * The Bug Hunter MACHINE surface — start/report/close plus the findings
 * lifecycle, called by the `.claude/workflows/bug-hunt.mjs` pipeline over
 * HTTP (it runs as an external Claude Code agent, not in-process, so it can't
 * call BugHunterService/BugFindingService directly).
 *
 * `x-api-key` guarded (`ApiAuthGuard`, same platform `API_KEY` already used
 * for ally-ai/ally-ai-learn inbound calls — see the webhook controllers under
 * `roleplay-studio/` for the identical pattern) rather than
 * `@RequireFeatureToggle`: that decorator's `AuthGuard('jwt')` requires a
 * logged-in human, which an autonomous pipeline is not. Split into its own
 * controller (not just a different decorator on the same class) so the two
 * auth models never mix on one route table by accident.
 */
@ApiTags('Bug Hunter Pipeline')
@Controller('v1/bug-hunter')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class BugHunterPipelineController {
  constructor(
    private readonly bugHunterService: BugHunterService,
    private readonly bugFindingService: BugFindingService,
    private readonly finderDataService: BugHunterFinderDataService,
  ) {}

  @Get('pipeline/prod-logs')
  @ApiOperation({
    summary:
      "Last 24h of a repo's CloudWatch errors, for the production-log finder (pipeline only). Null events for a repo with no log group (frontend repos).",
  })
  async getProdLogs(
    @Query('repo') repo: string,
  ): Promise<{ events: ProdLogFinding[] | null }> {
    return { events: await this.finderDataService.getRecentErrors(repo) };
  }

  @Get('pipeline/reported-bugs')
  @ApiOperation({
    summary:
      'Human-reported bugs still at NEW, for the reported-bugs finder (pipeline only)',
  })
  async getReportedBugs(): Promise<{ items: ReportedBugFinding[] }> {
    return { items: await this.finderDataService.getReportedBugs() };
  }

  @Get('pipeline/approved-findings')
  @ApiOperation({
    summary:
      'Manual-mode findings an admin has approved for this repo, waiting for the Fix phase (pipeline only)',
  })
  async getApprovedFindings(
    @Query('repo') repo: string,
  ): Promise<{ items: BugFindingDto[] }> {
    const items = await this.bugFindingService.listApprovedForRepo(repo);
    return { items: items.map(toFindingDto) };
  }

  @Post('runs')
  @ApiOperation({
    summary:
      'Start a run, or record a skipped-disabled run if the switch is off (pipeline only)',
  })
  async startRun(
    @Body() body: { trigger: BugHuntTrigger; repo: string },
  ): Promise<{ runId: string | null; mode: string | null }> {
    const mode = await this.bugHunterService.requireEnabledOrRecordSkip(
      body.trigger,
      body.repo,
    );
    if (!mode) return { runId: null, mode: null };
    const run = await this.bugHunterService.startRun(body.trigger, body.repo);
    return { runId: run.id, mode };
  }

  @Post('runs/:id/findings')
  @ApiOperation({
    summary:
      "Persist one Discover round's findings against a repo, deduped against still-open findings (pipeline only)",
    description:
      'Returns the persisted rows in the same order as the input — the ' +
      'pipeline should zip each one back to its own in-memory finding and use ' +
      '`.id` in every subsequent report/status call about it.',
  })
  async persistFindings(
    @Param('id', ParseUUIDPipe) runId: string,
    @Body() body: { repo: string; findings: RawFinding[] },
  ): Promise<{ items: BugFindingDto[] }> {
    const findings = await this.bugFindingService.persistFindings(
      runId,
      body.repo,
      body.findings,
    );
    return { items: findings.map(toFindingDto) };
  }

  @Patch('pipeline/findings/:id')
  @ApiOperation({
    summary:
      'Transition a finding: dismiss on refute, fixing on fix-start, pr_opened/merged/failed on fix-finish, needs_input + a question on genuine escalation (pipeline only)',
  })
  async patchFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      status?: BugFindingStatus;
      prUrl?: string;
      escalationQuestion?: string;
    },
  ): Promise<BugFindingDto> {
    return toFindingDto(await this.bugFindingService.setStatus(id, body));
  }

  @Get('pipeline/findings/:id/answer')
  @ApiOperation({
    summary:
      "Poll target for the fix agent's bounded escalation-wait loop (pipeline only)",
  })
  async getFindingAnswer(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ answered: boolean; answer: string | null }> {
    return this.bugFindingService.getAnswerIfReady(id);
  }

  @Post('runs/:id/report')
  @ApiOperation({
    summary: 'Append one pipeline event to a run (pipeline only)',
  })
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      repo?: string;
      stage: BugHuntEventDto['stage'];
      summary: string;
      payload?: Record<string, any>;
      suggestionId?: string;
      findingId?: string;
    },
  ): Promise<BugHuntEventDto> {
    return toEventDto(
      await this.bugHunterService.appendEvent({ runId: id, ...body }),
    );
  }

  @Post('runs/:id/close')
  @ApiOperation({
    summary: 'Close a run with final totals (pipeline only)',
  })
  async closeRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      status: 'completed' | 'failed';
      foundCount: number;
      autoMergedCount: number;
      prOpenedCount: number;
      dismissedCount: number;
      errorMessage?: string;
    },
  ): Promise<BugHuntRunDetailDto> {
    const { status, errorMessage, ...totals } = body;
    const run = await this.bugHunterService.closeRun(
      id,
      status === 'failed'
        ? BugHuntRunStatus.FAILED
        : BugHuntRunStatus.COMPLETED,
      totals,
      errorMessage,
    );
    const { events } = await this.bugHunterService.getRunWithEvents(id);
    return { ...toRunDto(run), events: events.map(toEventDto) };
  }
}
