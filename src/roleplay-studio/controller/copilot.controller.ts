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
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { CopilotSessionService } from '../service/copilot-session.service';
import { CopilotOrchestratorService } from '../service/copilot-orchestrator.service';
import {
  AcceptSuggestedTestCasesDto,
  CreateCopilotMessageDto,
  CreateCopilotSessionDto,
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

  @Get('sessions/:sessionId')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({ summary: 'Get a copilot session' })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.getSession(sessionId, user.id);
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

    try {
      const frames = this.copilotOrchestratorService.streamTurn(
        sessionId,
        dto,
        user.id,
      );
      for await (const frame of frames) {
        res.write(
          `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`,
        );
      }
    } catch (error) {
      // Errors inside the generator are already surfaced as `error` frames;
      // this catches pre-stream failures (404/403, model auth, …) plus the
      // post-stream assistant-message append. A missing session (getSession or
      // appendMessage) is tagged `session_not_found` so the client can silently
      // re-create the session and replay the turn instead of dead-ending.
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof NotFoundException
          ? 'session_not_found'
          : 'stream_failed';
      this.logger.error(
        `Copilot stream failed for session ${sessionId}: ${message}`,
      );
      res.write(`event: error\ndata: ${JSON.stringify({ code, message })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post('sessions/:sessionId/test-cases')
  @AuthPermissions([PERMISSIONS.EDIT_ROLEPLAY_COPILOT])
  @ApiOperation({
    summary:
      'Accept suggested test cases (creates agent_test_cases + appends ids to the draft spec)',
  })
  acceptTestCases(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AcceptSuggestedTestCasesDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.copilotSessionService.acceptSuggestedTestCases(
      sessionId,
      dto,
      user.id,
    );
  }
}
