import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { BuilderBuildService } from '../service/builder-build.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderQuestionService } from '../service/builder-question.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderReportService } from '../service/builder-report.service';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderExemplarService } from '../service/builder-exemplar.service';
import { BuilderEpicService } from '../service/builder-epic.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import {
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { buildBuildPrompt } from '../constants/builder-build-prompt';
import { buildPlanPrompt } from '../constants/builder-plan-prompt';
import { buildRemediatePrompt } from '../constants/builder-remediate-prompt';
import { buildFinalisePrompt } from '../constants/builder-finalise-prompt';
import { buildVerifyPrompt } from '../constants/builder-verify-prompt';
import { buildFixPrompt } from '../constants/builder-fix-prompt';
import {
  BUILDER_EVENT_BATCH_MAX,
  BUILDER_LESSONS_IN_CONTEXT,
  BUILDER_MAX_CODE_ITERATIONS,
  BUILDER_SIZE_PROFILES,
  classifyBuildSize,
  prdTechnicalPlanLength,
} from '../constants/builder.constants';
import {
  BUILDER_REPOS,
  findBuilderRepo,
} from '../constants/builder-repos.constants';
import { BuilderRunMode, BuilderRunStatus } from '../enum/builder.enum';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderPrdDocument } from '../type/builder-prd.type';
import {
  IngestBuilderEventsDto,
  RecordBuilderPrsDto,
  RecordBuilderQuestionsDto,
  RecordBuilderReportDto,
  RecordBuilderFeedbackOutcomesDto,
  RecordBuilderRunCostDto,
  CompleteBuilderRunDto,
  UpsertBuilderRepoMapDto,
} from '../dto/builder-pipeline.dto';

/**
 * The machine-facing half of Builder: what a GitHub Actions runner calls back
 * into while a build is in flight.
 *
 * A separate controller class from the admin one, deliberately — these routes
 * authenticate with a shared API key rather than a user's JWT, and the two
 * auth models must never end up on one route table by accident.
 *
 * The build protocol is served from here rather than baked into the workflow
 * file, so a change to how builds work takes effect on the next dispatch
 * instead of after a PR merges.
 */
@ApiTags('Builder pipeline (machine)')
@ApiSecurity('x-api-key')
@UseGuards(ApiAuthGuard)
@Controller({ path: 'builder/pipeline', version: '1' })
export class BuilderPipelineController {
  private readonly logger = LoggerService.getInstance(
    BuilderPipelineController.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly buildService: BuilderBuildService,
    private readonly eventService: BuilderEventService,
    private readonly questionService: BuilderQuestionService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly reportService: BuilderReportService,
    private readonly settingsService: BuilderSettingsService,
    private readonly exemplarService: BuilderExemplarService,
    private readonly epicService: BuilderEpicService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly prdService: BuilderPrdService,
    private readonly sessionService: BuilderSessionService,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly questionRepository: BuilderQuestionRepository,
  ) {}

  /**
   * Run + session + PRD + repo definitions, which every phase prompt needs.
   * One loader so a new phase cannot accidentally resolve repos differently
   * from the others.
   */
  private async loadRunContext(runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    const repos = (session.repos ?? [])
      .map((repo) => findBuilderRepo(repo))
      .filter(Boolean) as typeof BUILDER_REPOS;
    return { run, session, doc, repos };
  }

  @Get('runs/:runId/prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The build protocol for this run, rendered server-side',
  })
  async getPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const { run, session, doc, repos } = await this.loadRunContext(runId);

    // A fix run's work is a list of complaints about an open pull request, not
    // a PRD to implement, so it gets its own protocol from the same URL — the
    // runner does not need to know which kind of run it is fetching for.
    if (run.mode === BuilderRunMode.FIX) {
      return this.renderFixPrompt(run, session, doc, repos);
    }

    const lessons = await this.knowledgeService.listLessonTexts(
      BUILDER_LESSONS_IN_CONTEXT,
      session.repos ?? undefined,
    );

    // A resume run gets the answers it was waiting on plus a condensed
    // account of where the previous run got to — never a transcript replay,
    // which would cost more tokens than the work it describes.
    let resumeContext: string | null = null;
    let answeredQuestions: { prompt: string; answer: string }[] | undefined;
    if (run.resumeOfRunId) {
      resumeContext = await this.buildService.buildResumeContext(
        run.resumeOfRunId,
      );
      const pending = await this.questionRepository.find({
        where: { runId: run.resumeOfRunId },
        order: { position: 'ASC' },
      });
      if (pending.length) {
        answeredQuestions = await this.questionService.answeredForGroup(
          pending[0].groupId,
        );
      }
    }

    // The frozen selection from the interview, so the build reads the same
    // worked examples the PRD was written against.
    const { digests: exemplars } =
      await this.exemplarService.digestsForSession(session);

    const milestone = await this.resolveMilestoneBlock(run);

    return buildBuildPrompt({
      sessionId: session.id,
      runId: run.id,
      branchSlug: run.branchSlug,
      mode: run.mode,
      prd: doc.draft,
      repos,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      sessionUrl: `${this.configService.adminBaseUrl}/builder/${session.id}`,
      lessons,
      exemplars,
      milestone,
      branches: run.branches,
      resumeContext,
      answeredQuestions,
    });
  }

  /**
   * The milestone context for an epic run: its slice of the PRD, what earlier
   * milestones already delivered, and the branch to stack on.
   */
  private async resolveMilestoneBlock(run: BuilderBuildRun) {
    if (!run.milestoneId) return null;

    const milestones = await this.epicService.listBySession(run.sessionId);
    const current = milestones.find((m) => m.id === run.milestoneId);
    if (!current) return null;

    const completed = milestones.filter(
      (m) => m.position < current.position && m.status === 'COMPLETED',
    );
    // Stack on the last completed milestone's branch, so this slice can build
    // on code nobody has merged yet.
    const previous = completed[completed.length - 1];

    return {
      position: current.position,
      total: milestones.length,
      title: current.title,
      summaryMd: current.summaryMd,
      requirementIds: current.requirementIds ?? [],
      technicalNotesMd: current.technicalNotesMd,
      baseBranch: previous ? `builder/${previous.branchSlug}` : null,
      completed: completed.map((m) => ({
        position: m.position,
        title: m.title,
        branch: `builder/${m.branchSlug}`,
      })),
    };
  }

  /**
   * The fix protocol for a run pointed at an open pull request.
   *
   * Feedback rows are claimed as IN_FIX on the way out: without that, a
   * reconcile tick landing mid-run would count them as still pending and
   * dispatch a second fix run at the same comments.
   */
  private async renderFixPrompt(
    run: BuilderBuildRun,
    session: BuilderSession,
    doc: { draft: BuilderPrdDocument },
    repos: typeof BUILDER_REPOS,
  ): Promise<string> {
    if (!run.pullRequestId) {
      throw new BadRequestException(
        'This fix run has no pull request attached, so there is nothing to fix.',
      );
    }
    const pullRequest = await this.pullRequestService.getById(
      run.pullRequestId,
    );
    const feedback = await this.pullRequestService.claimForFix(
      run.pullRequestId,
      run.id,
    );
    const settings = await this.settingsService.get();

    return buildFixPrompt({
      sessionId: session.id,
      runId: run.id,
      branchSlug: run.branchSlug,
      prd: doc.draft,
      repos,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      pullRequest: {
        repo: pullRequest.repo,
        branch: pullRequest.branch,
        prNumber: pullRequest.prNumber,
        prUrl: pullRequest.prUrl,
        ciStatus: pullRequest.ciStatus ?? null,
      },
      feedback: feedback.map((item) => ({
        id: item.id,
        kind: item.kind,
        author: item.author ?? null,
        body: item.body ?? null,
        path: item.path ?? null,
        line: item.line ?? null,
      })),
      // Floored at 1: the counter is incremented at dispatch, so a prompt
      // re-fetched before that landed would otherwise read "attempt 0 of 3".
      attempt: Math.max(1, pullRequest.fixRunCount),
      maxAttempts: settings.maxFixRunsPerPr ?? 3,
    });
  }

  @Post('runs/:runId/feedback')
  @ApiOperation({
    summary: 'What a fix run did with each piece of review feedback',
  })
  async recordFeedbackOutcomes(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderFeedbackOutcomesDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const updated = await this.pullRequestService.recordFeedbackOutcomes(
      run.id,
      run.sessionId,
      dto.outcomes,
    );
    return { ok: true, updated };
  }

  /**
   * The advisory plan length for this run's size class.
   *
   * Re-derived from the same inputs the dispatch sized the run from, rather
   * than stored on the run: `classifyBuildSize` is pure, the PRD is frozen once
   * a build starts, and a column would need a migration plus a CHECK extension
   * to hold a value that is already computable.
   */
  private async planWordsFor(
    session: BuilderSession,
    doc: { draft?: BuilderPrdDocument | null },
  ): Promise<number> {
    const draft = (doc?.draft ?? {}) as Record<string, any>;
    const milestones = await this.epicService.listBySession(session.id);
    const size = classifyBuildSize({
      requirementCount: Array.isArray(draft.requirements)
        ? draft.requirements.length
        : 0,
      repoCount: (session.repos ?? []).length,
      technicalPlanLength: prdTechnicalPlanLength(draft),
      isEpic: milestones.length > 0,
    });
    return BUILDER_SIZE_PROFILES[size].planWords;
  }

  @Get('runs/:runId/plan-prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The planning prompt (stronger-model pass, read-only tools)',
  })
  async getPlanPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const { run, session, doc, repos } = await this.loadRunContext(runId);
    const lessons = await this.knowledgeService.listLessonTexts(
      BUILDER_LESSONS_IN_CONTEXT,
      session.repos ?? undefined,
    );
    const resumeContext = run.resumeOfRunId
      ? await this.buildService.buildResumeContext(run.resumeOfRunId)
      : null;
    const repoPacks = await this.knowledgeService.renderRepoPacks(
      session.repos ?? undefined,
    );

    return buildPlanPrompt({
      sessionId: session.id,
      runId: run.id,
      branchSlug: run.branchSlug,
      prd: doc.draft,
      repos,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      lessons,
      resumeContext,
      repoPacks,
      planWords: await this.planWordsFor(session, doc),
    });
  }

  @Get('runs/:runId/remediate-prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary:
      'The remediation prompt: the coder re-invoked with gate failures and reviewer objections',
  })
  async getRemediatePrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('round') round?: string,
  ): Promise<string> {
    const { run, session, doc, repos } = await this.loadRunContext(runId);
    const phase = await this.buildService.getRunPhaseContext(run.id);

    return buildRemediatePrompt({
      sessionId: session.id,
      runId: run.id,
      branchSlug: run.branchSlug,
      prd: doc.draft,
      repos,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      round: Math.max(2, Number(round) || 2),
      maxRounds: BUILDER_MAX_CODE_ITERATIONS,
      gateFailures: phase.gateFailures,
      objections: phase.objections,
      planMd: phase.planMd,
    });
  }

  @Get('runs/:runId/finalise-prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary:
      'The finalise prompt: E2E, push, PRs, report — after a green verify',
  })
  async getFinalisePrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const { run, session, doc, repos } = await this.loadRunContext(runId);
    const phase = await this.buildService.getRunPhaseContext(run.id);

    return buildFinalisePrompt({
      sessionId: session.id,
      runId: run.id,
      branchSlug: run.branchSlug,
      prd: doc.draft,
      repos,
      apiBaseUrl: this.configService.publicApiBaseUrl,
      sessionUrl: `${this.configService.adminBaseUrl}/builder/${session.id}`,
      gateSummary: phase.gateSummary,
      verifierNotes: phase.verifierNotes,
      planMd: phase.planMd,
    });
  }

  @Get('runs/:runId/verify-prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The adversarial verification prompt (fresh-context second pass)',
  })
  async getVerifyPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('round') round?: string,
  ): Promise<string> {
    const { run, doc, repos } = await this.loadRunContext(runId);
    const requestedRound = Math.max(1, Number(round) || 1);
    const phase = await this.buildService.getRunPhaseContext(run.id);

    // Round 2 is told what round 1 raised, read back from the stored
    // verification event. This branch was dead before the verdict was
    // persisted, so every round reviewed as if it were the first.
    const previousObjections =
      requestedRound > 1
        ? phase.objections.map((objection) =>
            [
              objection.severity ? `[${objection.severity}]` : '',
              [objection.repo, objection.file].filter(Boolean).join(' · '),
              objection.summary ?? '',
            ]
              .filter(Boolean)
              .join(' ')
              .trim(),
          )
        : undefined;

    return buildVerifyPrompt({
      prd: doc.draft,
      repos,
      round: requestedRound,
      previousObjections,
      gateSummary: phase.gateSummary,
    });
  }

  @Post('runs/:runId/events')
  @ApiOperation({ summary: 'Append a batch of build events' })
  async ingestEvents(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: IngestBuilderEventsDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    if (dto.events.length > BUILDER_EVENT_BATCH_MAX) {
      throw new BadRequestException(
        `At most ${BUILDER_EVENT_BATCH_MAX} events per batch.`,
      );
    }
    const saved = await this.eventService.ingest(run, dto.events);
    return {
      accepted: saved.length,
      lastSeq: saved[saved.length - 1]?.seq ?? null,
    };
  }

  @Post('runs/:runId/questions')
  @ApiOperation({ summary: 'Pause the run and ask the admin (batched)' })
  async recordQuestions(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderQuestionsDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const saved = await this.questionService.recordPause(
      run,
      dto.questions,
      dto.branches ?? null,
    );
    return {
      ok: true,
      groupId: saved[0]?.groupId ?? null,
      note: 'Questions recorded. Exit 0 now — a resume run will continue from your branches.',
    };
  }

  @Post('runs/:runId/prs')
  @ApiOperation({ summary: 'Record the pull requests this run opened' })
  async recordPullRequests(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderPrsDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const saved = await this.pullRequestService.recordFromRunner(
      run.sessionId,
      run.id,
      dto.pullRequests,
    );
    return { ok: true, recorded: saved.length };
  }

  @Post('runs/:runId/report')
  @ApiOperation({ summary: "Store the agent's account of its own work" })
  async recordReport(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderReportDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);
    await this.reportService.recordFromRunner({
      sessionId: run.sessionId,
      runId: run.id,
      type: dto.type,
      contentMd: dto.contentMd,
      metrics: dto.metrics ?? null,
      repos: session.repos ?? undefined,
    });
    return { ok: true };
  }

  @Post('runs/:runId/cost')
  @ApiOperation({ summary: 'Report token usage and cost for this run' })
  async recordCost(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: RecordBuilderRunCostDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    await this.buildService.recordRunCost(run, dto);
    return { ok: true };
  }

  @Post('runs/:runId/complete')
  @ApiOperation({ summary: 'Finish the run' })
  async complete(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: CompleteBuilderRunDto,
  ) {
    const run = await this.buildService.getRunOrFail(runId);

    // A run that already parked itself on a question stays parked: the
    // workflow's `if: failure()` net fires on the way out of a pause too, and
    // without this guard it would overwrite WAITING_FOR_INPUT with FAILED and
    // strand the questions nobody can now answer.
    if (run.status === BuilderRunStatus.WAITING_FOR_INPUT) {
      return { ok: true, note: 'Run is paused for input; completion ignored.' };
    }

    // A `done` needs a machine-verified gate behind it. Testing used to be
    // prompt-instructed with the agent's own `test_output` string as the only
    // evidence, so a run that skipped it entirely still settled SUCCEEDED.
    // Refused rather than trusted: the gate is cheap and the claim is not
    // checkable any other way.
    if (
      dto.outcome === 'done' &&
      !(await this.buildService.hasPassingGate(run.id))
    ) {
      this.logger.warn(
        `Builder run ${run.id} reported done with no passing test gate — failing it instead.`,
      );
      await this.buildService.settleRun(
        run,
        BuilderRunStatus.FAILED,
        'The run reported success but no passing test gate was recorded, so nothing proves the change works.',
      );
      return {
        ok: false,
        note: 'No passing gate_result for this run. Run the test gate before completing.',
      };
    }

    await this.buildService.settleRun(
      run,
      dto.outcome === 'done'
        ? BuilderRunStatus.SUCCEEDED
        : BuilderRunStatus.FAILED,
      dto.outcome === 'done' ? null : (dto.error ?? 'The build failed.'),
    );

    if (dto.outcome === 'done') {
      await this.reportService.composeSessionReport(run.sessionId);
    }
    return { ok: true };
  }

  /**
   * What the run looks like from the outside, for the workflow's own
   * outcome gate to read after the engine exits.
   *
   * `claude -p` exits 0 whenever the agent produces a final response — including
   * when it ends its turn mid-protocol. That makes "stopped without reporting"
   * indistinguishable from success at the workflow level, so the workflow asks
   * here instead of trusting its own exit code.
   */
  @Get('runs/:runId/status')
  @ApiOperation({
    summary: 'Run status, stage and PR count, for the runner outcome gate',
  })
  async getRunStatus(@Param('runId', ParseUUIDPipe) runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    const pullRequests = await this.pullRequestService.listBySession(
      run.sessionId,
    );
    return {
      runId: run.id,
      status: run.status,
      pullRequestCount: pullRequests.filter((pr) => pr.runId === run.id).length,
    };
  }

  @Get('runs/:runId/budget')
  @ApiOperation({
    summary: 'Live spend against the session ceiling, checked between phases',
  })
  async getBudget(@Param('runId', ParseUUIDPipe) runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    return this.buildService.getBudgetState(run);
  }

  /**
   * The runner announcing that it has parked on the ceiling rather than
   * aborting, so the admin gets told and the feed records where it stopped.
   *
   * The runner posts this once and then polls `/budget` until the ceiling moves
   * or the window it is handed back runs out.
   */
  @Post('runs/:runId/budget-hold')
  @ApiOperation({
    summary: 'A run is holding at a phase boundary, waiting for a raise',
  })
  async budgetHold(@Param('runId', ParseUUIDPipe) runId: string) {
    const run = await this.buildService.getRunOrFail(runId);
    return this.buildService.recordBudgetHold(run);
  }

  @Get('repo-commands')
  @ApiOperation({ summary: 'Repos Builder can work in, with their commands' })
  listRepoCommands() {
    return { repos: BUILDER_REPOS };
  }

  @Post('repo-maps')
  @ApiOperation({
    summary: 'Upsert a Repo Knowledge Pack (context-refresh workflow)',
  })
  async upsertRepoMap(@Body() dto: UpsertBuilderRepoMapDto) {
    const map = await this.knowledgeService.upsertRepoMap({
      repo: dto.repo,
      mapMd: dto.mapMd,
      commitSha: dto.commitSha ?? null,
      stats: dto.stats ?? null,
    });
    return { ok: true, repo: map.repo, generatedAt: map.generatedAt };
  }
}
