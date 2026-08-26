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
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderSessionService } from '../service/builder-session.service';
import {
  BuilderBuildRunRepository,
  BuilderQuestionRepository,
} from '../repository/builder-build.repository';
import { buildBuildPrompt } from '../constants/builder-build-prompt';
import { buildVerifyPrompt } from '../constants/builder-verify-prompt';
import {
  BUILDER_EVENT_BATCH_MAX,
  BUILDER_LESSONS_IN_CONTEXT,
} from '../constants/builder.constants';
import {
  BUILDER_REPOS,
  findBuilderRepo,
} from '../constants/builder-repos.constants';
import { BuilderRunStatus } from '../enum/builder.enum';
import {
  IngestBuilderEventsDto,
  RecordBuilderPrsDto,
  RecordBuilderQuestionsDto,
  RecordBuilderReportDto,
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
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly prdService: BuilderPrdService,
    private readonly sessionService: BuilderSessionService,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly questionRepository: BuilderQuestionRepository,
  ) {}

  @Get('runs/:runId/prompt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiOperation({
    summary: 'The build protocol for this run, rendered server-side',
  })
  async getPrompt(
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<string> {
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );

    const repos = (session.repos ?? [])
      .map((repo) => findBuilderRepo(repo))
      .filter(Boolean) as typeof BUILDER_REPOS;

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
      branches: run.branches,
      resumeContext,
      answeredQuestions,
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
    const run = await this.buildService.getRunOrFail(runId);
    const session = await this.sessionService.getSession(run.sessionId);
    const doc = await this.prdService.getOrCreateDoc(
      session.id,
      session.createdBy,
    );
    const repos = (session.repos ?? [])
      .map((repo) => findBuilderRepo(repo))
      .filter(Boolean) as typeof BUILDER_REPOS;

    return buildVerifyPrompt({
      prd: doc.draft,
      repos,
      round: Math.max(1, Number(round) || 1),
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
