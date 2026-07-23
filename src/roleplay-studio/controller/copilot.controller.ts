import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { CopilotSessionService } from '../service/copilot-session.service';
import { CopilotOrchestratorService } from '../service/copilot-orchestrator.service';
import { RoleplayTestRunService } from '../service/roleplay-test-run.service';
import {
  COPILOT_SSE_PING_INTERVAL_MS,
  COPILOT_TURN_LOCK_PREFIX,
} from '../constants/roleplay-studio.constants';
import {
  CreateCopilotMessageDto,
  CreateCopilotSessionDto,
  ListCopilotSessionsQueryDto,
} from '../dto/copilot.dto';

@ApiTags('Roleplay Studio Copilot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'roleplay-studio/copilot', version: '1' })
export class CopilotController {
  private readonly logger = LoggerService.getInstance(CopilotController.name);

  constructor(
    private readonly copilotSessionService: CopilotSessionService,
    private readonly copilotOrchestratorService: CopilotOrchestratorService,
    private readonly testRunService: RoleplayTestRunService,
    private readonly redisService: RedisService,
    private readonly configService: AppConfigService,
  ) {}

  @Post('sessions')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({ summary: 'Start a copilot session over a spec' })
  createSession(
    @Body() dto: CreateCopilotSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.createSession(dto.specId, user.id);
  }

  @Get('sessions')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary:
      "List the caller's ACTIVE copilot sessions for a spec (newest first) — cross-browser resume",
  })
  listSessions(
    @Query() query: ListCopilotSessionsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.listOwnedSessions(query.specId, user.id);
  }

  @Get('sessions/:sessionId')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({ summary: 'Get a copilot session with its full transcript' })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.getSessionWithMessages(
      sessionId,
      user.id,
    );
  }

  @Get('sessions/:sessionId/messages')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({ summary: 'Copilot transcript (ordered by seq)' })
  listMessages(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.listMessages(sessionId, user.id);
  }

  @Post('sessions/:sessionId/messages/stream')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary:
      'Stream one copilot turn (SSE: token / tool_call / tool_result / spec_patch / question / error / done)',
  })
  async streamMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateCopilotMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Disconnect tracking + write guard. Auto-improve turns are consumed to
    // completion even after the client is gone (the chat panel unmounts on
    // tab switch and useCopilotStream aborts on unmount — the assistant
    // append + re-run trigger must survive that); plain turns keep the old
    // semantics so Stop still aborts the turn. NB: req 'close' fires on
    // request-body completion on modern Node, not on disconnect — the
    // response 'close' with the stream still writable is the real signal.
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

    // Per-session turn mutex: concurrent streams would interleave tool calls
    // over the same draft and clobber each other's patches.
    const lockKey = `${COPILOT_TURN_LOCK_PREFIX}:${sessionId}`;
    const lockTtlSeconds =
      this.configService.roleplayStudio.improveTurnTimeoutMinutes * 60;
    const locked = await this.redisService.acquireLock(lockKey, lockTtlSeconds);
    if (!locked) {
      safeWrite('error', {
        code: 'turn_in_progress',
        message: 'Another copilot turn is already streaming for this session',
      });
      res.end();
      return;
    }

    // Keep-alive: long update_spec generations can emit nothing for 30-60s+,
    // which trips proxy idle timeouts without a heartbeat. Clients ignore it.
    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      COPILOT_SSE_PING_INTERVAL_MS,
    );

    const autoImprove = dto.autoImprove ?? null;
    try {
      if (autoImprove) {
        try {
          await this.testRunService.beginAutoImprove(
            autoImprove.reportId,
            sessionId,
            user.id,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Auto-improve rejected for report ${autoImprove.reportId}: ${message}`,
          );
          safeWrite('error', { code: 'auto_improve_rejected', message });
          return;
        }
      }

      let doneData: Record<string, any> | null = null;
      try {
        const frames = this.copilotOrchestratorService.streamTurn(
          sessionId,
          dto,
          user.id,
        );
        for await (const frame of frames) {
          if (frame.event === 'done') {
            doneData = frame.data;
          }
          if (autoImprove) {
            safeWrite(frame.event, frame.data);
          } else {
            res.write(
              `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`,
            );
          }
        }
      } catch (error) {
        // Errors inside the generator are already surfaced as `error` frames;
        // this catches pre-stream failures (404/403, model auth, …) plus the
        // post-stream assistant-message append. A missing session (getSession
        // or appendMessage) is tagged `session_not_found` so the client can
        // silently re-create the session and replay the turn instead of
        // dead-ending.
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? 'session_not_found'
            : 'stream_failed';
        this.logger.error(
          `Copilot stream failed for session ${sessionId}: ${message}`,
        );
        safeWrite('error', { code, message });
      } finally {
        // Close out the auto-improve regardless of how the turn ended: with a
        // captured `done` carrying specVersionId the SAME case re-runs pinned
        // to the copilot's output version; done without patches → NO_CHANGES;
        // no done → FAILED. Must never break SSE teardown.
        if (autoImprove) {
          try {
            await this.testRunService.finishAutoImproveTurn(
              autoImprove.reportId,
              user.id,
              doneData,
            );
          } catch (error) {
            this.logger.error(
              `Auto-improve finish failed for report ${autoImprove.reportId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.redisService.releaseLock(lockKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release copilot turn lock for session ${sessionId}: ${
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
