import {
  Body,
  Controller,
  Get,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
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
import {
  ApproveCourseCopilotBlueprintDto,
  CreateCourseCopilotMessageDto,
  CreateCourseCopilotSessionDto,
  RaiseCourseCopilotBudgetDto,
  RetryCourseCopilotBuildDto,
  UpdateCourseCopilotBlueprintDto,
} from '../dto/course-copilot.dto';
import {
  COURSE_COPILOT_SSE_PING_INTERVAL_MS,
  COURSE_COPILOT_TURN_LOCK_PREFIX,
  COURSE_COPILOT_TURN_LOCK_TTL_SECONDS,
} from '../constants/course-copilot.constants';
import { COURSE_COPILOT_ERROR_CODES } from '../type/course-copilot-sse.type';
import { CourseCopilotSessionService } from '../service/course-copilot-session.service';
import { CourseCopilotOrchestratorService } from '../service/course-copilot-orchestrator.service';
import { CourseCopilotBlueprintService } from '../service/course-copilot-blueprint.service';
import { CourseCopilotBuildService } from '../service/course-copilot-build.service';
import { CourseCopilotCostService } from '../service/course-copilot-cost.service';
import { CourseCopilotLandingPageService } from '../service/course-copilot-landing-page.service';
import {
  COURSE_COPILOT_ANALYTICS_EVENTS,
  CourseCopilotAnalyticsService,
} from '../service/course-copilot-analytics.service';

const STREAM_FAILED_MESSAGE =
  'That turn could not be started. Your answers are all still here — send your message ' +
  'again. If it keeps happening, ask an administrator to check the server logs.';

const VIEW = { permissions: [PERMISSIONS.VIEW_COURSE_COPILOT] };
const EDIT = { permissions: [PERMISSIONS.EDIT_COURSE_COPILOT] };

/**
 * Course Copilot: an admin agent that interviews a trainer, plans a course,
 * builds it as a DRAFT and edits it on request. Platform-tier only in release
 * 1 — the `course_copilot` toggle plus the view/edit permissions. Sessions are
 * private to the admin who started them.
 */
@ApiTags('Course Copilot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/course-copilot')
export class CourseCopilotController {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotController.name,
  );

  constructor(
    private readonly sessionService: CourseCopilotSessionService,
    private readonly orchestrator: CourseCopilotOrchestratorService,
    private readonly blueprintService: CourseCopilotBlueprintService,
    private readonly buildService: CourseCopilotBuildService,
    private readonly costService: CourseCopilotCostService,
    private readonly redisService: RedisService,
    private readonly analytics: CourseCopilotAnalyticsService,
    private readonly landingPageService: CourseCopilotLandingPageService,
  ) {}

  @Post('sessions')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary: 'Start a session, or open one on an existing course (EDIT mode)',
  })
  createSession(
    @Body() dto: CreateCourseCopilotSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.createSession(user, { trackId: dto.trackId });
  }

  @Get('sessions')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, VIEW)
  @ApiOperation({ summary: "The caller's sessions, newest first" })
  listSessions(@CurrentUser() user: TokenUser) {
    return this.sessionService.listSessions(user.id);
  }

  @Get('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, VIEW)
  @ApiQuery({ name: 'afterSeq', required: false })
  @ApiOperation({
    summary:
      'A session with transcript, jobs, events after afterSeq, outline and budget',
  })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query('afterSeq') afterSeq: string | undefined,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.getDetail(
      sessionId,
      user.id,
      Number(afterSeq) || 0,
    );
  }

  @Put('sessions/:sessionId/blueprint')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary: 'Save the blueprint as edited in the tree (version-checked)',
  })
  async updateBlueprint(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateCourseCopilotBlueprintDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    return this.blueprintService.replace(session, dto.blueprint, dto.version);
  }

  @Post('sessions/:sessionId/blueprint/approve')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary:
      'Approve the blueprint: create the DRAFT course and start the build',
  })
  async approveBlueprint(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: ApproveCourseCopilotBlueprintDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    const approved = await this.blueprintService.approve(
      session,
      dto.version,
      user.id,
    );
    await this.buildService.createJobsForBlueprint(
      approved,
      approved.approvedBlueprint!,
    );
    const estimate = approved.approvedBlueprint!.estimate;
    this.analytics.capture(
      COURSE_COPILOT_ANALYTICS_EVENTS.BLUEPRINT_APPROVED,
      user.id,
      {
        session_id: approved.id,
        track_id: approved.trackId ?? null,
        items: estimate?.items ?? 0,
        new_roleplays: estimate?.newRoleplays ?? 0,
        minutes: estimate?.minutes ?? 0,
        estimate_usd: estimate?.usd ?? 0,
      },
    );
    this.buildService.start(approved.id);
    return this.sessionService.getDetail(sessionId, user.id);
  }

  @Post('sessions/:sessionId/build/retry')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary:
      'Re-queue failed or skipped jobs (all of them when jobIds is omitted)',
  })
  async retryBuild(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RetryCourseCopilotBuildDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    await this.buildService.retry(session, dto.jobIds);
    return this.sessionService.getDetail(sessionId, user.id);
  }

  @Post('sessions/:sessionId/build/cancel')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({ summary: 'Stop the build; keep what is already written' })
  async cancelBuild(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    await this.buildService.cancel(session);
    return this.sessionService.getDetail(sessionId, user.id);
  }

  @Get('sessions/:sessionId/budget')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, VIEW)
  @ApiOperation({ summary: 'Spend so far against the session ceiling' })
  async getBudget(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    return this.costService.budget(session);
  }

  @Post('sessions/:sessionId/budget')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary:
      'Raise the ceiling (0 = uncapped); releases jobs held at the old one',
  })
  async raiseBudget(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RaiseCourseCopilotBudgetDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getOwned(sessionId, user.id);
    await this.buildService.raiseBudget(session, dto.budgetUsd);
    return this.costService.budget(
      await this.sessionService.getOwned(sessionId, user.id),
    );
  }

  @Post('sessions/:sessionId/archive')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary: 'Archive the session (the course it made is untouched)',
  })
  async archive(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.sessionService.archive(sessionId, user.id);
    return { success: true };
  }

  @Post('tracks/:trackId/landing-page-draft')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary:
      "Draft a course's story-led landing page from the saved course (nothing is saved)",
    description:
      'Reads the saved course — title, description, sections, items, roleplay ' +
      'summaries, trigger warnings and the current landing page — and returns ' +
      '`{ draft }`, a full landing page: chapters only for sections that exist, ' +
      'no persona image or character id, every block switched on. The caller ' +
      'merges it into the fields the author left empty and saves through the ' +
      "course's own PUT. 404 when the course does not exist; 502 with a " +
      'readable message when the model output cannot be used after one repair ' +
      'pass.',
  })
  draftLandingPage(@Param('trackId', ParseUUIDPipe) trackId: string) {
    return this.landingPageService.draft(trackId);
  }

  @Post('sessions/:sessionId/messages/stream')
  @RequireFeatureToggle(FeatureToggleKey.COURSE_COPILOT, EDIT)
  @ApiOperation({
    summary:
      'Stream one turn (SSE: token / tool_call / tool_result / question / brief / blueprint / course_patch / build_started / error / done)',
  })
  async streamMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateCourseCopilotMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Stop proxies (nginx, the ALB) buffering the stream into one late blob.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) clientGone = true;
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    // One turn at a time per session: two streams would interleave tool loops
    // over the same transcript and the same course.
    const lockKey = `${COURSE_COPILOT_TURN_LOCK_PREFIX}:${sessionId}`;
    if (
      !(await this.redisService.acquireLock(
        lockKey,
        COURSE_COPILOT_TURN_LOCK_TTL_SECONDS,
      ))
    ) {
      safeWrite('error', {
        code: COURSE_COPILOT_ERROR_CODES.TURN_IN_PROGRESS,
        message:
          'A reply is still being written for this session. Wait for it to finish.',
      });
      res.end();
      return;
    }

    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      COURSE_COPILOT_SSE_PING_INTERVAL_MS,
    );

    try {
      try {
        for await (const frame of this.orchestrator.streamTurn(
          sessionId,
          dto,
          user.id,
        )) {
          safeWrite(frame.event, frame.data);
          // Stop / reload / closed tab: end the loop so the generator settles
          // the transcript row and the lock is released now, not at its TTL.
          if (clientGone) break;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? COURSE_COPILOT_ERROR_CODES.SESSION_NOT_FOUND
            : COURSE_COPILOT_ERROR_CODES.STREAM_FAILED;
        this.logger.error(
          `Course Copilot stream failed for ${sessionId}: ${detail}`,
        );
        safeWrite('error', {
          code,
          message:
            error instanceof HttpException ? detail : STREAM_FAILED_MESSAGE,
        });
      }
    } finally {
      clearInterval(heartbeat);
      await this.redisService
        .releaseLock(lockKey)
        .catch((error) =>
          this.logger.warn(
            `Failed to release Course Copilot turn lock for ${sessionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      if (!res.writableEnded) res.end();
    }
  }
}
