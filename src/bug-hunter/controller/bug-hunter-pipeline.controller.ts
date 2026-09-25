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
import { BugFindingService } from '../service/bug-finding.service';
import {
  BugHunterFinderDataService,
  ProdLogFinding,
  ReportedBugFinding,
  WebErrorFinding,
} from '../service/bug-hunter-finder-data.service';
import {
  BugHuntRunDetailDto,
  BugHuntEventDto,
  BugFindingDto,
  CloseBugHuntRunDto,
  PatchBugFindingDto,
  PersistBugFindingsDto,
  RecordBugFixPlanDto,
  RecordBugHuntRunCostDto,
  RecordBugHuntRunModelDto,
  ReportBugHuntEventDto,
  StartBugHuntRunDto,
} from '../dto/bug-hunter.dto';
import { BugFixSessionService } from '../service/bug-fix-session.service';
import { BugHunterTelemetryService } from '../service/bug-hunter-telemetry.service';
import {
  RecordBugHuntContextDto,
  RecordBugHuntLookupDto,
  RecordBugHuntPhaseDto,
} from '../dto/bug-hunter-telemetry.dto';
import { BugHuntLookupKind } from '../enum/bug-hunt-telemetry.enum';
import { BugHunterEvalService } from '../service/bug-hunter-eval.service';
import { BugHunterPolicyService } from '../service/bug-hunter-policy.service';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { AGENT_MEMORY_IN_CONTEXT } from 'src/agent-memory/constants/agent-memory.constants';
import {
  BugHunterMemorySearchResponseDto,
  SearchBugHunterMemoryQueryDto,
  WriteBugHunterMemoryDto,
} from '../dto/bug-hunter-memory.dto';
import {
  BugHunterEvalSetDto,
  BugHunterEvalSetQueryDto,
  RecordBugHunterEvalRunDto,
} from '../dto/bug-hunter-eval.dto';
import { BugHuntRunStatus } from '../enum/bug-hunt-run.enum';
import { toEventDto, toRunDto, toFindingDto } from './bug-hunter.controller';
import { buildFixSessionPrompt } from '../constants/bug-fix-prompt';
import {
  BUG_HUNT_REPOS,
  BugHuntRepoConfig,
} from '../constants/bug-hunt-repos.constants';
import { buildSweepPrompt } from '../constants/bug-hunt-sweep-prompt';
import { BugHunterModelSettingsService } from '../service/bug-hunter-model-settings.service';
import { BugHunterModelSettingsDto } from '../dto/bug-hunter.dto';

/**
 * The Bug Hunter MACHINE surface — start/report/close plus the findings
 * lifecycle, called by the `.claude/workflows/bug-hunt.mjs` pipeline over
 * HTTP (it runs as an external Claude Code agent, not in-process, so it can't
 * call BugHunterService/BugFindingService directly).
 *
 * `x-api-key` guarded (`ApiAuthGuard`, same platform `API_KEY` already used
 * for ally-ai/ally-ai-learn inbound calls — see the webhook controllers under
 * the identical pattern elsewhere) rather than
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
    private readonly modelSettingsService: BugHunterModelSettingsService,
    private readonly telemetryService: BugHunterTelemetryService,
    private readonly evalService: BugHunterEvalService,
    private readonly policyService: BugHunterPolicyService,
    private readonly memoryService: AgentMemoryService,
  ) {}

  @Get('pipeline/memory/search')
  @ApiOperation({
    summary: "Search Bug Hunter's notebook by meaning (pipeline only)",
    description:
      'The nearest active entries for a question, narrowed to the repo in play plus ' +
      'platform-wide ones. Pass ?runId= and the lookup is recorded as a memory context ' +
      'lookup with its top relevance, so "asked the notebook and got nothing" is a fact ' +
      'the pipeline telemetry can count. See docs/bug-hunter-memory-adr.md.',
  })
  @ApiResponse({ status: 200, type: BugHunterMemorySearchResponseDto })
  async searchMemory(
    @Query() query: SearchBugHunterMemoryQueryDto,
  ): Promise<BugHunterMemorySearchResponseDto> {
    const hits = await this.telemetryService.timed(
      query.runId,
      BugHuntLookupKind.MEMORY,
      () =>
        this.memoryService.search({
          agent: AgentMemoryAgent.BUG_HUNTER,
          query: query.q,
          repo: query.repo,
          limit: query.limit,
          minSimilarity: query.minSimilarity,
        }),
      (rows) => ({
        itemCount: rows.length,
        chars: rows.reduce((sum, r) => sum + r.body.length, 0),
      }),
      { repo: query.repo ?? null, queryChars: query.q.length },
    );
    return { hits };
  }

  @Post('pipeline/memory')
  @ApiOperation({
    summary: "Write one lesson to Bug Hunter's notebook (pipeline only)",
    description:
      'Under 600 characters, written for a stranger. Lands active and is embedded for ' +
      'search best-effort; a failed embed is recorded on the row and healed later, never ' +
      'thrown. Curation of candidates into the active set is OPP-0714.',
  })
  async writeMemory(
    @Body() body: WriteBugHunterMemoryDto,
  ): Promise<{ id: string }> {
    const row = await this.memoryService.write({
      agent: AgentMemoryAgent.BUG_HUNTER,
      body: body.body,
      repos: body.repos,
      tags: body.tags,
      runId: body.runId ?? null,
      findingId: body.findingId ?? null,
      // The pipeline may not pin: a pin is a human outranking the curator.
      pinned: false,
    });
    return { id: row.id };
  }

  @Get('pipeline/eval-set')
  @ApiOperation({
    summary:
      'Settled findings with a truth label, for replaying the verifier prompt (pipeline only)',
    description:
      'Findings a human rejected as not_a_bug, dismissals a shipped fix later reversed, and ' +
      'fixes that merged or released — each with the ORIGINAL description the verifier saw. ' +
      'Declines for wont_fix, too_risky, duplicate, wrong_repo and other are excluded: they ' +
      'say nothing about whether the code was wrong. ?includeWeak=true adds uncontradicted ' +
      'verifier dismissals older than the decline-suppression window, marked weak. Consumed ' +
      'by scripts/bug-hunter/eval-verifier.mjs.',
  })
  @ApiResponse({ status: 200, type: BugHunterEvalSetDto })
  async getEvalSet(
    @Query() query: BugHunterEvalSetQueryDto,
  ): Promise<BugHunterEvalSetDto> {
    return this.evalService.buildSet({
      repo: query.repo,
      limit: query.limit,
      includeWeak: query.includeWeak === 'true',
    });
  }

  @Post('pipeline/eval-runs')
  @ApiOperation({
    summary:
      'Store the score of one replay of a prompt over the eval set (pipeline only)',
    description:
      'Keyed by the sha256 of the prompt as run and the model, so two rows with the same pair ' +
      'are the same experiment. Written by scripts/bug-hunter/eval-verifier.mjs after a run.',
  })
  async recordEvalRun(
    @Body() body: RecordBugHunterEvalRunDto,
  ): Promise<{ id: string }> {
    const row = await this.evalService.recordRun(body);
    return { id: row.id };
  }

  // The four finder-data reads below take an optional `?runId=`. When the
  // sweep passes it, the fetch is recorded as a context lookup on that run —
  // how many items came back, how large, how long it took — with no further
  // cooperation from the agent. See BugHunterTelemetryService.timed. Omitting
  // it changes nothing about the response, so older workflow copies keep
  // working unmeasured.

  @Get('pipeline/prod-logs')
  @ApiOperation({
    summary:
      "Last 24h of a repo's CloudWatch errors, for the production-log finder (pipeline only). Null events for a repo with no log group (frontend repos). Pass ?runId= to record the lookup on that run.",
  })
  async getProdLogs(
    @Query('repo') repo: string,
    @Query('runId') runId?: string,
  ): Promise<{ events: ProdLogFinding[] | null }> {
    const events = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.PROD_LOGS,
      () => this.finderDataService.getRecentErrors(repo),
      measureList,
      { repo },
    );
    return { events };
  }

  @Get('pipeline/web-logs')
  @ApiOperation({
    summary:
      "Last 24h of a repo's browser-side PostHog exceptions, for the web-error finder (pipeline only). Null events for a repo with no PostHog-instrumented client (every repo but ally-web today). Pass ?runId= to record the lookup on that run.",
  })
  async getWebLogs(
    @Query('repo') repo: string,
    @Query('runId') runId?: string,
  ): Promise<{ events: WebErrorFinding[] | null }> {
    const events = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.WEB_LOGS,
      () => this.finderDataService.getWebErrors(repo),
      measureList,
      { repo },
    );
    return { events };
  }

  @Get('pipeline/reported-bugs')
  @ApiOperation({
    summary:
      'Human-reported bugs still at NEW, for the reported-bugs finder (pipeline only). Optional ?repo= narrows to items already classified as this repo, plus anything still unfiled. Pass ?runId= to record the lookup on that run.',
  })
  async getReportedBugs(
    @Query('repo') repo?: string,
    @Query('runId') runId?: string,
  ): Promise<{ items: ReportedBugFinding[] }> {
    const items = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.REPORTED_BUGS,
      () => this.finderDataService.getReportedBugs(repo),
      measureList,
      { repo: repo ?? null },
    );
    return { items };
  }

  @Get('pipeline/approved-findings')
  @ApiOperation({
    summary:
      'Manual-mode findings an admin has approved for this repo, waiting for the Fix phase (pipeline only). Pass ?runId= to record the lookup on that run.',
  })
  async getApprovedFindings(
    @Query('repo') repo: string,
    @Query('runId') runId?: string,
  ): Promise<{ items: BugFindingDto[] }> {
    const items = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.APPROVED_FINDINGS,
      () => this.bugFindingService.listApprovedForRepo(repo),
      measureList,
      { repo },
    );
    return { items: items.map(toFindingDto) };
  }

  @Post('runs/:id/phases')
  @ApiOperation({
    summary:
      'Mark the start or end of a phase, for per-phase timing (pipeline only)',
    description:
      'The agent POSTs {"phase","event":"started"|"finished"} as it enters and leaves each ' +
      'phase of the sweep (discover, verify, fix, close) or fix protocol (reproduce, fix, suite, ' +
      'pr). One row per run and phase; a repeated start keeps the first start and counts the ' +
      'repeat, so a second fix attempt extends the fix phase rather than replacing it.',
  })
  async recordPhase(
    @Param('id', ParseUUIDPipe) runId: string,
    @Body() body: RecordBugHuntPhaseDto,
  ): Promise<{ ok: true }> {
    await this.telemetryService.recordPhase(runId, body);
    return { ok: true };
  }

  @Post('runs/:id/lookups')
  @ApiOperation({
    summary:
      'Record a context lookup the agent performed itself, such as a memory search (pipeline only)',
    description:
      'Only for lookups the server cannot see. The pipeline endpoints above record themselves ' +
      'when called with ?runId=; posting one of those kinds here double-counts it.',
  })
  async recordLookup(
    @Param('id', ParseUUIDPipe) runId: string,
    @Body() body: RecordBugHuntLookupDto,
  ): Promise<{ ok: true }> {
    await this.telemetryService.recordReportedLookup(runId, body);
    return { ok: true };
  }

  @Post('runs/:id/context')
  @ApiOperation({
    summary:
      'Record how much of the repo the agent was shown — commits, files and lines in scope, deep or diff-scoped (pipeline only)',
  })
  async recordContext(
    @Param('id', ParseUUIDPipe) runId: string,
    @Body() body: RecordBugHuntContextDto,
  ): Promise<{ ok: true }> {
    await this.telemetryService.recordContext(runId, body);
    return { ok: true };
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
  getRepoCommands(): { repos: Record<string, BugHuntRepoConfig> } {
    return { repos: BUG_HUNT_REPOS };
  }

  @Get('pipeline/models')
  @ApiOperation({
    summary:
      'Which models the sweep/fix session and its escalation subagent should run on (pipeline only)',
    description:
      'Fetched at runtime by `bug-hunt-sweep.yml`/`bug-fix-session.yml`, on every trigger path — ' +
      'including the nightly cron sweep, which never goes through `workflow_dispatch` and so ' +
      'cannot receive this as a dispatch input. Takes an optional `?repo=` for parity with this ' +
      "controller's other endpoints, but does not read it yet: Bug Hunter's model settings are " +
      "platform-wide, same as Builder's.",
  })
  @ApiResponse({ status: 200, type: BugHunterModelSettingsDto })
  async getModels(): Promise<BugHunterModelSettingsDto> {
    return this.modelSettingsService.get();
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
    // The engine the runner is about to use. Read here rather than passed in:
    // the workflow resolves it from the same settings row a step later, and
    // the prompt has to know it NOW because Gemini has no Task tool, so its
    // Verify phase cannot be the Claude one — see buildSweepPrompt.
    const { engine } = await this.modelSettingsService.get();
    // What this repo's reviewers already ruled were not bugs. Fetched here
    // rather than baked into the workflow file for the same reason the whole
    // protocol is served rather than copied: it changes every time someone
    // triages, and a sweep should read the current state of the argument.
    const knownNonBugs = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.KNOWN_NON_BUGS,
      () => this.bugFindingService.listKnownNonBugs(repo),
      (rows) => ({
        itemCount: rows.length,
        chars: rows.reduce(
          (sum, row) =>
            sum +
            row.title.length +
            row.reason.length +
            (row.note?.length ?? 0),
          0,
        ),
      }),
      { repo },
    );
    // The always-on half of memory: the strongest notebook entries for this
    // repo, rendered up front. Recorded as a memory lookup like a search, so
    // the telemetry counts the context the agent was handed either way.
    const memories = await this.telemetryService.timed(
      runId,
      BugHuntLookupKind.MEMORY,
      () =>
        this.memoryService.listActive(
          AgentMemoryAgent.BUG_HUNTER,
          repo,
          AGENT_MEMORY_IN_CONTEXT,
        ),
      (rows) => ({
        itemCount: rows.length,
        chars: rows.reduce((sum, r) => sum + r.body.length, 0),
      }),
      { repo, mode: 'always_on' },
    );
    return buildSweepPrompt({
      repo,
      runId,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      mode: settings.mode,
      deep: deep === 'true',
      knownNonBugs,
      engine,
      memories: memories.map((m) => ({
        id: m.id,
        body: m.body,
        tags: m.tags,
        repos: m.repos,
      })),
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
      'Start a run, or record a skipped run if the switch is off or (for a scheduled sweep) the repo has nothing new (pipeline only)',
  })
  @ApiResponse({ status: 400, description: 'Unrecognised `trigger`.' })
  async startRun(@Body() body: StartBugHuntRunDto): Promise<{
    runId: string | null;
    mode: string | null;
    skippedReason?: 'disabled' | 'quiet';
  }> {
    const mode = await this.bugHunterService.requireEnabledOrRecordSkip(
      body.trigger,
      body.repo,
    );
    if (!mode) return { runId: null, mode: null, skippedReason: 'disabled' };

    const worthSweeping =
      await this.bugHunterService.requireWorthSweepingOrRecordSkip(
        body.trigger,
        body.repo,
      );
    if (!worthSweeping) {
      return { runId: null, mode, skippedReason: 'quiet' };
    }

    const run = await this.bugHunterService.startRun(body.trigger, body.repo);
    return { runId: run.id, mode };
  }

  @Get('runs/:id/status')
  @ApiOperation({
    summary: 'Whether a run is still open (pipeline only)',
    description:
      'Read by each sweep workflow immediately after `claude -p` exits. The ' +
      'CLI exits 0 whenever the agent produces a final response — including ' +
      'when it ends its turn mid-protocol without closing its run — so a ' +
      'green job is not evidence the sweep finished. A run still RUNNING at ' +
      'that point was abandoned, and the workflow fails itself rather than ' +
      'leaving it open forever. Deliberately narrower than the admin ' +
      "controller's run detail: a CI gate needs the status and nothing else.",
  })
  async getRunStatus(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: BugHuntRunStatus }> {
    const run = await this.bugHunterService.getRun(id);
    return { status: run.status };
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
  @ApiResponse({
    status: 400,
    description:
      'A finding carries an unrecognised `source`/`severity`, or no `description`. Nothing is persisted — retry the batch.',
  })
  async persistFindings(
    @Param('id', ParseUUIDPipe) runId: string,
    @Body() body: PersistBugFindingsDto,
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
  @ApiResponse({ status: 400, description: 'Unrecognised `status`.' })
  @ApiResponse({
    status: 403,
    description:
      'The transition breaks an autonomy rule: fixing an unverified, low-confidence or unapproved-in-MANUAL finding, or merging a guarded-path, never-merges-here, over-cap or non-trivial change. The message says which and what to do instead.',
  })
  async patchFinding(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PatchBugFindingDto,
  ): Promise<BugFindingDto> {
    // The rules the sweep prompt states, enforced where the agent's write
    // arrives — see BugHunterPolicyService. Human routes never pass through
    // here, which is the point: a person's decision is what these defer to.
    await this.policyService.assertTransitionAllowed(id, body);
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
  @ApiResponse({
    status: 400,
    description:
      "Malformed `modelUsage`. Worth a real response: `recordActualCost` is best-effort and swallows its own failures, so a bad body used to drop this run's cost data with nothing but a log line.",
  })
  async recordCost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordBugHuntRunCostDto,
  ): Promise<{ totalTokenCostUsd: string }> {
    await this.bugHunterService.recordActualCost(id, body);
    const run = await this.bugHunterService.getRun(id);
    return { totalTokenCostUsd: run.totalTokenCostUsd };
  }

  @Post('runs/:id/model')
  @ApiOperation({
    summary: 'Attach which CLI/model actually ran this run (pipeline only)',
    description:
      'Called by the "Resolve configured models" workflow step right after ' +
      'it resolves `GET pipeline/models` — ally-be never learns this at ' +
      'dispatch time, since the model is resolved independently inside the ' +
      'CI workflow on every trigger path, including the nightly cron sweep. ' +
      "Powers the findings list's model/provider label.",
  })
  async recordModel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RecordBugHuntRunModelDto,
  ): Promise<{ engine: string; model: string }> {
    await this.bugHunterService.recordResolvedModel(id, body);
    return body;
  }

  @Post('runs/:id/close')
  @ApiOperation({
    summary: 'Close a run with final totals (pipeline only)',
  })
  @ApiResponse({
    status: 400,
    description:
      'Missing or unrecognised `status`. The run stays OPEN rather than being recorded as completed — see CloseBugHuntRunDto.',
  })
  async closeRun(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseBugHuntRunDto,
  ): Promise<BugHuntRunDetailDto> {
    const { status, errorMessage } = body;
    // Omitting a total has always meant "leave it at zero"; naming the zeros
    // is the same write, just no longer by way of an undefined the UPDATE
    // happens to skip.
    const totals = {
      foundCount: body.foundCount ?? 0,
      autoMergedCount: body.autoMergedCount ?? 0,
      prOpenedCount: body.prOpenedCount ?? 0,
      dismissedCount: body.dismissedCount ?? 0,
    };
    const run = await this.bugHunterService.closeRun(
      id,
      // Safe as a two-way branch only because CloseBugHuntRunDto has already
      // refused anything that is not one of these two. It used to be reachable
      // with any value at all, which quietly filed a failed sweep as
      // COMPLETED.
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

/**
 * Size a finder-data response for the context-lookup record: item count and
 * serialised size. `null` (a repo with no log group) is zero items, which is
 * the right reading of "asked, nothing there" — see `BugHuntContextLookup`.
 */
function measureList<T>(result: T[] | null): {
  itemCount: number;
  chars: number;
} {
  if (!result) return { itemCount: 0, chars: 0 };
  return { itemCount: result.length, chars: JSON.stringify(result).length };
}
