import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { TokenUser } from 'src/auth/type/auth.types';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ScenarioSessionChatService } from '../service/scenario-session-chat.service';
import { CreateChatMessageDto } from '../dto/create-chat-message.dto';

@ApiTags('Scenario Session Chat')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn/scenario-sessions',
  version: '1',
})
export class ScenarioSessionChatController {
  constructor(
    private readonly scenarioSessionChatService: ScenarioSessionChatService,
  ) {}

  @Post(':scenarioSessionId/chat/stream')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({ summary: 'Stream AI chat response for a scenario session' })
  async streamChat(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
    @Body() dto: CreateChatMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const observable = await this.scenarioSessionChatService.streamChat(
      scenarioSessionId,
      user.id,
      dto.message,
    );

    observable.subscribe({
      next: (event) => {
        res.write(`data: ${event.data}\n\n`);
      },
      complete: () => {
        res.end();
      },
      error: () => {
        res.end();
      },
    });
  }

  @Get(':scenarioSessionId/chat/history')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
  @ApiOperation({ summary: 'Get chat history for a scenario session' })
  getChatHistory(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.scenarioSessionChatService.getChatHistory(
      scenarioSessionId,
      user.id,
    );
  }
}
