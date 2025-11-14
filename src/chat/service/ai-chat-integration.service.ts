import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { AiService } from '../../ai/service/ai.service';
import { SettingsService } from '../../settings/service/settings.service';
import { MessageService } from './message.service';
import { CallDetailsService } from './call-details.service';
import { AuditLoggerService } from '../../audit/service/audit-logger.service';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { ChatEvents } from '../constants/chat.constants';
import { MessageRequest } from '../../ai/dto/ai.request.dto';
import { GenerateSummaryResponse } from '../../ai/dto/ai.response.dto';
import {
  NudgeResponse,
  UserChatSessionData,
  SendMessageWebSocketData,
} from '../type/chat.type';
import { MessageType } from '../entity/message.entity';

@Injectable()
export class AiChatIntegrationService {
  private readonly logger = LoggerService.getInstance(
    AiChatIntegrationService.name,
  );
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private aiService: AiService,
    private settingsService: SettingsService,
    private messageService: MessageService,
    private callDetailsService: CallDetailsService,
  ) {}

  async enhance(summary: string) {
    return this.aiService.enhance(summary);
  }

  getNudge(newMessage: string, messageRequests: MessageRequest[]) {
    return this.aiService.getNudge(newMessage, messageRequests);
  }

  async tagPositivityRatings(tags: string[]) {
    const aiResponse = await this.aiService.generateTagPositivityRatings(tags);
    return aiResponse.tags;
  }

  async generateSummaryForMessage(
    messageRequests: MessageRequest[],
  ): Promise<GenerateSummaryResponse | undefined> {
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    if (aiResponse) {
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.SUMMARY_GENERATED_FROM_MESSAGES,
        details: {
          messageRequests,
        },
      });
      return aiResponse;
    }
    return;
  }

  async triggerNudge(
    newMessage: { content: string; chatId: number; id: number },
    session: UserChatSessionData,
    chatId: number,
    channel: string,
    onHandleNudge: (
      nudgeResponse: NudgeResponse,
      session: UserChatSessionData,
      parentMessage: { content: string; chatId: number; id: number },
      channel: string,
    ) => Promise<void>,
  ) {
    const isChatPaused = await this.callDetailsService.isChatPaused(chatId);
    if (isChatPaused) {
      this.logger.debug(`Chat is paused for chatId ${chatId}`);
      return;
    }
    const isNudgeEnabled = await this.settingsService.getNudgeStatus();
    if (!isNudgeEnabled) {
      this.logger.debug(`Nudge is disabled for chatId ${chatId}`);
      return;
    }
    const messages = await this.messageService.getChatHistoryForAIService(
      chatId,
      {
        sortBy: 'createdAt',
        order: 'DESC',
        limit: 4,
      },
    );

    const formattedNewMessage = `${session.role}: ${newMessage.content}`;

    this.aiService
      .getNudge(formattedNewMessage, messages)
      .then((nudge) => {
        this.logger.debug(
          `Nudge:${newMessage.content} | chatId :${chatId} | ${nudge?.nudge} | stage: ${nudge?.stage}`,
        );
        if (nudge) {
          onHandleNudge(nudge, session, newMessage, channel);
        }
      })
      .catch((error) => {
        this.logger.error(
          `AI Nudge Error: ${error.message} | chatId : ${chatId} | userId : ${session.userId}`,
        );
      });
  }

  async handleNudge(
    nudgeResponse: NudgeResponse,
    session: UserChatSessionData,
    parentMessage: { content: string; chatId: number; id: number },
    channel: string,
    persistAndBroadcastMessage: (
      session: UserChatSessionData,
      data: SendMessageWebSocketData,
      broadCastOptions: { event?: ChatEvents },
      channel: string,
    ) => Promise<any>,
  ) {
    this.logger.debug(
      `handleNudge - nudge :${nudgeResponse.nudge} | stage :${nudgeResponse.stage}`,
    );
    const { nudge, stage } = nudgeResponse;
    if (nudge) {
      await persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: nudge,
          messageType: MessageType.NUDGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.NUDGE,
        },
        channel,
      );
    }
    if (stage) {
      await persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: stage,
          messageType: MessageType.STAGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.STAGE,
        },
        channel,
      );
    }
  }
}
