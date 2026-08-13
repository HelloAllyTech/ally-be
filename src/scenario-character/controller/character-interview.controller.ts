import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import { SUPER_DUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { CharacterInterviewSessionService } from '../service/character-interview-session.service';
import { CharacterInterviewOrchestratorService } from '../service/character-interview-orchestrator.service';
import { CreateCharacterInterviewMessageDto } from '../dto/character-interview.dto';
import {
  CHARACTER_INTERVIEW_SSE_PING_INTERVAL_MS,
  CHARACTER_INTERVIEW_TURN_LOCK_PREFIX,
  CHARACTER_INTERVIEW_TURN_LOCK_TTL_SECONDS,
} from '../constants/character-interview.constants';

/**
 * Character-library interview agent (SSE chat, modeled on CopilotController).
 * Same gates as the rest of the character library; creating a character is
 * the whole point of an interview, so all routes require
 * CREATE_SCENARIO_CHARACTER.
 */
@ApiTags('Scenario Character interview agent')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/scenario-characters/interview')
export class CharacterInterviewController {
  private readonly logger = LoggerService.getInstance(
    CharacterInterviewController.name,
  );

  constructor(
    private readonly sessionService: CharacterInterviewSessionService,
    private readonly orchestratorService: CharacterInterviewOrchestratorService,
    private readonly redisService: RedisService,
  ) {}

  @Post('sessions')
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.CREATE_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Start a character interview session' })
  createSession(@CurrentUser() user: TokenUser) {
    return this.sessionService.createSession(user.id);
  }

  @Get('sessions')
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.CREATE_SCENARIO_CHARACTER],
  })
  @ApiOperation({
    summary:
      "List the caller's ACTIVE interview sessions (newest first) — cross-browser resume",
  })
  listSessions(@CurrentUser() user: TokenUser) {
    return this.sessionService.listOwnedSessions(user.id);
  }

  @Get('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.CREATE_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Get an interview session with its transcript' })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.getSessionWithMessages(sessionId, user.id);
  }

  @Post('sessions/:sessionId/messages/stream')
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    permissions: [PERMISSIONS.CREATE_SCENARIO_CHARACTER],
  })
  @ApiOperation({
    summary:
      'Stream one interview turn (SSE: token / tool_call / tool_result / question / character_draft / error / done)',
  })
  async streamMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateCharacterInterviewMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Disconnect tracking + write guard (see CopilotController for the
    // response-'close' rationale).
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
    // over the same transcript.
    const lockKey = `${CHARACTER_INTERVIEW_TURN_LOCK_PREFIX}:${sessionId}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      CHARACTER_INTERVIEW_TURN_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      safeWrite('error', {
        code: 'turn_in_progress',
        message: 'Another interview turn is already streaming for this session',
      });
      res.end();
      return;
    }

    // Keep-alive: the final draft generation can emit nothing for 30-60s+,
    // which trips proxy idle timeouts without a heartbeat. Clients ignore it.
    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      CHARACTER_INTERVIEW_SSE_PING_INTERVAL_MS,
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
        // Errors inside the generator are already surfaced as `error` frames;
        // this catches pre-stream failures (404/403, model auth, …). A missing
        // session is tagged `session_not_found` so the client can silently
        // re-create the session and replay the turn instead of dead-ending.
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? 'session_not_found'
            : 'stream_failed';
        this.logger.error(
          `Interview stream failed for session ${sessionId}: ${message}`,
        );
        safeWrite('error', { code, message });
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.redisService.releaseLock(lockKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release interview turn lock for session ${sessionId}: ${
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
