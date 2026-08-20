import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { AppConfigService } from 'src/config/config.service';

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
  RecordBugFixPlanDto,
  ReportBugHuntEventDto,
} from '../dto/bug-hunter.dto';
import { BugFixSessionService } from '../service/bug-fix-session.service';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { toEventDto, toRunDto, toFindingDto } from './bug-hunter.controller';
import { buildFixSessionPrompt } from '../constants/bug-fix-prompt';
import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import { buildSweepPrompt } from '../constants/bug-hunt-sweep-prompt';

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
    private readonly bugFixSessionService: BugFixSessionService,
    private readonly configService: AppConfigService,
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

  @Get('pipeline/findings/:id')
  @ApiOperation({
    summary:
      'The one finding a dispatched fix session was started for (pipeline only)',
    description:
      'A fix session is handed only its finding id as a workflow input — it ' +
      'reads the bug itself, plus any escalation answer already on record ' +
      'from a previous attempt, from here.',
  })
  async getFindingForPipeline(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BugFindingDto> {
    return toFindingDto(await this.bugFindingService.getOne(id));
  }

  @Get('pipeline/repo-commands')
  @ApiOperation({
    summary:
      'Test/lint commands and fixability for every repo Bug Hunter knows (pipeline only)',
    description:
      'The single definition of this map. It used to exist twice — once in ' +
      '`.claude/workflows/bug-hunt.mjs` and once in `bug-fix-prompt.ts` — and ' +
      'the two had already drifted by an entry. The workflow script now fetches ' +
      'it from here instead of carrying its own copy.',
  })
  getRepoCommands(): {
    repos: Record<string, { test: string; lint: string; fixable: boolean }>;
  } {
    return { repos: BUG_HUNT_REPOS };
  }

  @Get('pipeline/sweep-prompt')
  @ApiOperation({
    summary: 'The full repo-wide sweep protocol, as plain text (pipeline only)',
    description:
      'The unattended executor for a sweep. `.claude/workflows/bug-hunt.mjs` ' +
      'is a Claude Code Workflow script and cannot run on a GitHub runner, ' +
      'which is why nothing used to trigger a sweep automatically. ' +
      '`bug-hunt-sweep.yml` fetches this and hands it to Claude Code, exactly ' +
      'as `bug-fix-session.yml` already does with the fix protocol. The prompt ' +
      'embeds the mode, because MANUAL stops at pending_approval and AI carries ' +
      'on into Fix. Returns `text/plain` — the runner pipes it.',
  })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getSweepPrompt(
    @Query('repo') repo: string,
    @Query('runId') runId: string,
    @Query('deep') deep?: string,
  ): Promise<string> {
    // Validate here so an unknown repo is a 400 the runner can report clearly.
    // buildSweepPrompt also throws, but as a defensive invariant — surfacing
    // that as a 500 would read to an admin as a Bug Hunter outage rather than a
    // bad workflow input.
    if (!BUG_HUNT_REPOS[repo]) {
      throw new BadRequestException(
        `Bug Hunter is not configured for "${repo}". Known repos: ${Object.keys(
          BUG_HUNT_REPOS,
        ).join(', ')}.`,
      );
    }
    // Read the live mode rather than trusting a workflow input: the switch may
    // have moved between the dispatch and the runner actually starting, and the
    // mode decides whether this sweep is allowed to fix anything.
    const settings = await this.bugHunterService.getSettings();
    return buildSweepPrompt({
      repo,
      runId,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      mode: settings.mode,
      deep: deep === 'true',
    });
  }

  @Get('pipeline/findings/:id/fix-prompt')
  @ApiOperation({
    summary:
      'The full fix-session protocol for this finding, as plain text (pipeline only)',
    description:
      "Each repo's `bug-fix-session.yml` fetches this and hands it straight " +
      'to Claude Code, which is what keeps those four workflow files thin and ' +
      'genuinely identical instead of four drifting copies of the same ' +
      'protocol. The prompt is finding-specific: it embeds the bug, the repo ' +
      'commands, any answer an admin already gave, and whether merging is ' +
      'permitted (it is not, for a guarded path). Returns `text/plain` — the ' +
      'runner pipes it, it is not JSON for a client to parse.',
  })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async getFixPrompt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('runId') runId: string,
    @Query('repo') repo?: string,
  ): Promise<string> {
    const finding = await this.bugFindingService.getOne(id);
    return buildFixSessionPrompt({
      finding,
      repo: repo ?? finding.repo ?? '',
      runId,
      apiBaseUrl: this.configService.publicApiBaseUrl,
    });
  }

  @Post('pipeline/findings/:id/plan')
  @ApiOperation({
    summary:
      'Report that this bug spans several repos, as an ordered plan (pipeline only)',
    description:
      'A fix session only has one repo checked out, so on finding that a ' +
      'complete fix needs work elsewhere it reports the plan here instead of ' +
      'landing half of it. Bug Hunter turns each step into its own finding and ' +
      'drives them one at a time, then releases them in the same order. ' +
      '**`steps` must be in dependency order** — the step that has to ship ' +
      'first comes first. Idempotent: a retry returns the existing plan rather ' +
      'than creating a second set of steps.',
  })
  async recordPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordBugFixPlanDto,
  ): Promise<{ steps: BugFindingDto[] }> {
    const steps = await this.bugFixSessionService.recordPlan(id, body.steps);
    return { steps: steps.map(toFindingDto) };
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
    description:
      'An unrecognised `stage` is rejected with a 400 naming it, rather than ' +
      "reaching the column's CHECK constraint and coming back as a generic " +
      '500 — see ReportBugHuntEventDto for why this one route validates ' +
      'strictly.',
  })
  @ApiResponse({ status: 400, description: 'Unrecognised `stage`.' })
  async report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReportBugHuntEventDto,
  ): Promise<BugHuntEventDto> {
    return toEventDto(
      await this.bugHunterService.appendEvent({ runId: id, ...body }),
    );
  }

  @Post('runs/:id/cost')
  @ApiOperation({
    summary:
      "Attach this run's real per-model token usage from `claude -p --output-format json` (pipeline only)",
    description:
      'Called by the GitHub Actions runner after the sweep/fix-session ' +
      'agent finishes, always AFTER the agent already closed this run via ' +
      '/close — attaching cost to an already-closed run is the normal case. ' +
      'Writes one `llm_usage` row per model and re-derives `totalTokenCostUsd`.',
  })
  async recordCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      modelUsage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
      }[];
      cliReportedCostUsd?: number;
    },
  ): Promise<{ totalTokenCostUsd: string }> {
    await this.bugHunterService.recordActualCost(id, body);
    const run = await this.bugHunterService.getRun(id);
    return { totalTokenCostUsd: run.totalTokenCostUsd };
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
