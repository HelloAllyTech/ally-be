import {
  Body,
  Controller,
  Get,
  NotFoundException,
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
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderInterviewOrchestratorService } from '../service/builder-interview-orchestrator.service';
import { BuilderBuildService } from '../service/builder-build.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderQuestionService } from '../service/builder-question.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import { BuilderReportService } from '../service/builder-report.service';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderNotificationService } from '../service/builder-notification.service';
import { BuilderPrdVersionRepository } from '../repository/builder-prd.repository';
import { BuilderBuildRunRepository } from '../repository/builder-build.repository';
import {
  AnswerBuilderQuestionDto,
  CreateBuilderMessageDto,
  CreateBuilderSessionDto,
  ListBuilderSessionsQueryDto,
  PatchBuilderPrdDto,
  StartBuilderBuildDto,
  UpdateBuilderSessionDto,
  UpdateBuilderSettingsDto,
} from '../dto/builder.dto';
import {
  BUILDER_EVENT_PAGE_SIZE,
  BUILDER_SSE_PING_INTERVAL_MS,
  BUILDER_TURN_LOCK_PREFIX,
  BUILDER_TURN_LOCK_TTL_SECONDS,
} from '../constants/builder.constants';
import { BUILDER_REPOS } from '../constants/builder-repos.constants';

/**
 * Builder — the admin-facing half (JWT). The machine-facing pipeline that
 * build runners call back into is a separate controller class with its own
 * auth model, so the two never share a route table by accident.
 *
 * Gating follows the AI Lab pattern: a per-user feature toggle with the
 * platform-admin roles as the legacy escape hatch during the toggle rollout.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder', version: '1' })
export class BuilderController {
  private readonly logger = LoggerService.getInstance(BuilderController.name);

  constructor(
    private readonly sessionService: BuilderSessionService,
    private readonly prdService: BuilderPrdService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly orchestratorService: BuilderInterviewOrchestratorService,
    private readonly buildService: BuilderBuildService,
    private readonly eventService: BuilderEventService,
    private readonly questionService: BuilderQuestionService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly reportService: BuilderReportService,
    private readonly settingsService: BuilderSettingsService,
    private readonly notificationService: BuilderNotificationService,
    private readonly prdVersionRepository: BuilderPrdVersionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly redisService: RedisService,
  ) {}

  @Post('sessions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Start a Builder session (PRD interview)' })
  createSession(
    @Body() dto: CreateBuilderSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.createSession(user.id, {
      title: dto.title,
      tenantId: user.tenantId ?? null,
    });
  }

  @Get('sessions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: "List the caller's Builder sessions, newest first" })
  listSessions(
    @Query() query: ListBuilderSessionsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.listOwnedSessions(user.id, query.status);
  }

  @Get('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Session with transcript, PRD draft and readiness rubric',
  })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.getSessionDetail(sessionId, user.id);
  }

  @Patch('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Rename a session or set its repos / engine / model',
  })
  updateSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateBuilderSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.updateSession(sessionId, user.id, dto);
  }

  @Post('sessions/:sessionId/cancel')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Stop a session' })
  cancelSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.cancelSession(sessionId, user.id);
  }

  @Patch('sessions/:sessionId/prd')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Edit the PRD directly (RFC-6902); rejected while a build runs',
  })
  patchPrd(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PatchBuilderPrdDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.patchPrd(
      sessionId,
      user.id,
      dto.ops,
      dto.changeSummary,
    );
  }

  @Get('sessions/:sessionId/prd/versions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'PRD version history, newest first' })
  async listPrdVersions(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    // Ownership check first — the versions table is keyed by doc, not session.
    await this.sessionService.getSession(sessionId, user.id);
    const doc = await this.prdService.getOrCreateDoc(sessionId, user.id);
    return this.prdVersionRepository.listByDoc(doc.id);
  }

  @Get('repo-commands')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Repos Builder can work in, with their commands' })
  listRepoCommands() {
    return { repos: BUILDER_REPOS };
  }

  @Get('repo-maps')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Repo knowledge packs with their freshness (staleness display)',
  })
  async listRepoMaps() {
    const maps = await this.knowledgeService.listRepoMaps();
    return {
      maps: maps.map((map) => ({
        repo: map.repo,
        commitSha: map.commitSha,
        generatedAt: map.generatedAt,
        stats: map.stats,
      })),
    };
  }

  /* ── Builds ───────────────────────────────────────────────────────────── */

  @Post('sessions/:sessionId/start-build')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Dispatch a build run from the ready PRD' })
  async startBuild(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: StartBuilderBuildDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId, user.id);
    return this.buildService.startBuild(session, user.id, dto);
  }

  @Get('sessions/:sessionId/runs')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Build runs for a session, oldest first' })
  async listRuns(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSession(sessionId, user.id);
    return this.runRepository.listBySession(sessionId);
  }

  @Get('runs/:runId/events')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Build events after a cursor — the feed’s polling fallback',
  })
  async listRunEvents(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('afterSeq') afterSeq: string | undefined,
    @CurrentUser() user: TokenUser,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    // Ownership is on the session, not the run — check it before serving a
    // transcript that quotes an admin's own half-formed thinking.
    await this.sessionService.getSession(run.sessionId, user.id);
    const events = await this.eventService.listByRun(
      runId,
      Math.max(0, Number(afterSeq) || 0),
      BUILDER_EVENT_PAGE_SIZE,
    );
    return {
      events,
      lastSeq: events[events.length - 1]?.seq ?? (Number(afterSeq) || 0),
      runStatus: run.status,
    };
  }

  @Get('sessions/:sessionId/questions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Questions the build is waiting on' })
  async listPendingQuestions(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSession(sessionId, user.id);
    return this.questionService.listPending(sessionId);
  }

  @Post('sessions/:sessionId/questions/:questionId/answer')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Answer a mid-build question; resumes once the group is complete',
  })
  async answerQuestion(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() dto: AnswerBuilderQuestionDto,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSession(sessionId, user.id);
    const result = await this.questionService.answer(
      sessionId,
      questionId,
      user.id,
      { message: dto.message, answer: dto.answer as Record<string, any> },
    );
    return {
      question: result.question,
      resumed: Boolean(result.resumedRun),
      runId: result.resumedRun?.id ?? null,
    };
  }

  @Get('sessions/:sessionId/pull-requests')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Pull requests this session opened' })
  async listPullRequests(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSession(sessionId, user.id);
    return this.pullRequestService.listBySession(sessionId);
  }

  @Get('sessions/:sessionId/reports')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: "The agent's reports on its own work" })
  async listReports(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.getSession(sessionId, user.id);
    return this.reportService.listBySession(sessionId);
  }

  /* ── Settings & notifications ─────────────────────────────────────────── */

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'The kill switch, concurrency ceiling and defaults',
  })
  getSettings() {
    return this.settingsService.get();
  }

  @Patch('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Update Builder settings' })
  updateSettings(
    @Body() dto: UpdateBuilderSettingsDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.settingsService.update(
      {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.maxConcurrentBuilds !== undefined
          ? { maxConcurrentBuilds: dto.maxConcurrentBuilds }
          : {}),
        ...(dto.defaultBudgetUsd !== undefined
          ? { defaultBudgetUsd: String(dto.defaultBudgetUsd) }
          : {}),
      },
      user.id,
    );
  }

  @Get('notifications')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Your Builder inbox' })
  async listNotifications(@CurrentUser() user: TokenUser) {
    const [notifications, unread] = await Promise.all([
      this.notificationService.listForAdmin(user.id),
      this.notificationService.countUnread(user.id),
    ]);
    return { notifications, unread };
  }

  @Post('notifications/:id/read')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Mark one notification read' })
  async markNotificationRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.notificationService.markRead(id, user.id);
    return { ok: true };
  }

  @Post('notifications/read-all')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Mark every notification read' })
  async markAllNotificationsRead(@CurrentUser() user: TokenUser) {
    await this.notificationService.markAllRead(user.id);
    return { ok: true };
  }

  @Post('sessions/:sessionId/messages/stream')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Stream one interview turn (SSE: token / tool_call / tool_result / question / prd_draft / readiness / error / done)',
  })
  async streamMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateBuilderMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Disconnect tracking + write guard. `res` 'close' with !writableEnded is
    // the real disconnect signal — `req` 'close' fires on request-body
    // completion in modern Node and would false-positive on every turn.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true;
      }
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    // Per-session turn mutex: concurrent streams would interleave tool loops
    // over one transcript and one PRD.
    const lockKey = `${BUILDER_TURN_LOCK_PREFIX}:${sessionId}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      BUILDER_TURN_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      safeWrite('error', {
        code: 'turn_in_progress',
        message: 'Another turn is already streaming for this session',
      });
      res.end();
      return;
    }

    // Keep-alive: a turn that spends 40s researching the codebase emits
    // nothing, which trips proxy idle timeouts. Clients ignore these.
    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      BUILDER_SSE_PING_INTERVAL_MS,
    );

    try {
      try {
        const frames = this.orchestratorService.streamTurn(
          sessionId,
          dto,
          user.id,
        );
        for await (const frame of frames) {
          safeWrite(frame.event, frame.data);
        }
      } catch (error) {
        // Errors inside the generator already surface as `error` frames; this
        // catches pre-stream failures (404/403, model auth). A missing session
        // is tagged so the client can re-create and replay once instead of
        // dead-ending.
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? 'session_not_found'
            : 'stream_failed';
        this.logger.error(
          `Builder stream failed for session ${sessionId}: ${message}`,
        );
        safeWrite('error', { code, message });
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.redisService.releaseLock(lockKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release Builder turn lock for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
