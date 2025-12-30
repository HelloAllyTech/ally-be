import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { CryptoService } from '../../common/service/crypto.service';
import { AppConfigService } from '../../config/config.service';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { ChatRepository } from '../repository/chat.repository';
import { MessageService } from './message.service';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { AiService } from '../../ai/service/ai.service';
import { RedisService } from '../../redis/service/redis.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { CallInfoDto } from '../dto/chat.response.dto';
import { ChatUtil } from '../util/chat.util';
import { StringUtil } from '../../common/util/string.util';
import { AudioChatProvider } from '../../common/constants/chat.constants';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { TIME } from '../../common/constants/time.constants';
import { ForbiddenException } from '../../exception/custom.exception';
import { Chat } from '../entity/chat.entity';
import { MessageType } from '../entity/message.entity';
import { FlattenedSummaryNotePayloadCamelCase } from '../type/call.details.type';
import { CallInfo } from '../dto/call-log.response.dto';
import { CallDetails } from '../entity/call.details.entity';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';

@Injectable()
export class CallDetailsService {
  private readonly logger = LoggerService.getInstance(CallDetailsService.name);

  constructor(
    private callDetailsRepository: CallDetailsRepository,
    private chatRepository: ChatRepository,
    private messageService: MessageService,
    private cryptoService: CryptoService,
    private readonly config: AppConfigService,
    private aiService: AiService,
    private readonly cache: RedisService,
    private broadcastMessageService: BroadcastMessageService,
    private streamFileProcessorService: StreamFileProcessorService,
  ) {}

  async handleChatEnded(chat: Chat) {
    this.logger.debug(`handleChatEnded - chatId: ${chat.id}`);
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chat.id, tenantId: ExecutionManager.getTenantId() },
    });
    const provider = callDetails?.callInfo?.provider;

    const channel = findMessageBrokerChannelUsingProvider(provider!);
    let participants;

    this.logger.debug(
      `handleChatEnded - chatId: ${chat.id} | provider: ${provider}`,
    );

    if (provider === AudioChatProvider.WEBRTC) {
      participants = [chat.counselorId!, chat.clientId];
      await Promise.allSettled([
        this.updateSummaryAndTags(chat),
        this.updateMessageStatistics(chat, callDetails),
      ]);
    } else if (
      provider === AudioChatProvider.MICROPHONE ||
      provider === AudioChatProvider.EXOTEL_CONFERENCE_CALL
    ) {
      participants = [chat.counselorId!];
      await this.streamFileProcessorService.endCallStream({
        chatId: chat.id,
        provider,
      });
    } else if (provider === AudioChatProvider.OZONETEL) {
      participants = [chat.counselorId!];
    }
    if (channel && participants) {
      this.broadcastMessageService.broadcastChatEndedEvent(channel, {
        participants,
        chatId: chat.id,
      });
    }
  }

  async updateSummaryAndTags(chat: Chat) {
    const summary: any = (await this.generateSummary(chat.id)) || {};

    if (summary && summary.sessionSummary) {
      summary.sessionSummary = await this.cryptoService.encrypt(
        summary.sessionSummary,
        this.config.phiData?.phiDataEncryptionKey,
      );
    }

    await this.callDetailsRepository.update(
      { chatId: chat.id },
      {
        summary,
      },
    );
  }

  async addNoteToSession(
    chatId: number,
    createNoteDto: AddNoteDto,
  ): Promise<AddNotesResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new NotFoundException('User not found');
    }
    const chat = await this.chatRepository.findOne({
      where: {
        counselorId: userId,
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    if (!chat) {
      throw new NotFoundException('Chat not Found');
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });

    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }

    const existingCallInfo = callDetails.callInfo || {};
    const updatedCallInfo = {
      ...existingCallInfo,
      notes: createNoteDto.content,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );

    return { notes: createNoteDto.content };
  }

  async updateCallMetadata(chat: Chat, duration?: number) {
    this.logger.debug(`updateCallDetails:Start - chatId:${chat.id}`);
    try {
      const callDetails = await this.callDetailsRepository.findOne({
        where: { chatId: chat.id, tenantId: ExecutionManager.getTenantId() },
      });

      let callDurationInSeconds;
      const endDate = chat.endedAt || new Date();

      if (duration) {
        callDurationInSeconds = duration;
      } else {
        const startDate = chat.startedAt || new Date();

        callDurationInSeconds = ChatUtil.getCallDurationInSeconds(
          startDate,
          endDate,
        );
      }

      if (callDetails) {
        const updates = {
          endTime: endDate,
          callDuration: callDurationInSeconds,
        };
        await this.callDetailsRepository.update({ chatId: chat.id }, updates);
      }
    } catch (err) {
      this.logger.error(
        `updateCallMetadata - chatId:${chat.id} - error:${err}`,
      );
    }
  }

  async updateMessageStatistics(chat: Chat, callDetails?: CallDetails | null) {
    this.logger.debug(
      `updateMessageStatistics:Start - chatId:${chat.id} | startedAt:${chat.startedAt} | endedAt:${chat.endedAt}`,
    );
    try {
      const chatId = chat.id;
      const { messages } = await this.messageService.getMessageByChatId(
        chatId,
        {
          sortBy: 'createdAt',
          order: 'ASC',
        },
      );
      const startDate = chat.startedAt || new Date();
      const endDate = chat.endedAt || new Date();

      const callDurationInSeconds = ChatUtil.getCallDurationInSeconds(
        startDate,
        endDate,
      );

      // get word count by language
      const wordCountByLanguage = await this.getWordCountByLanguage(chat.id);

      let noOfNudges = 0;
      let noOfStages = 0;
      let clientWordCount = 0;
      let counselorWordCount = 0;
      //format transcript also get the client talking percentage
      let transcript = '';
      let currentStage = '';

      messages.forEach((message) => {
        if (message.type === MessageType.NUDGE) {
          noOfNudges++;
        }
        if (
          message.type === MessageType.STAGE &&
          currentStage !== message.content
        ) {
          noOfStages++;
          currentStage = message.content;
        }
        if (message.type !== MessageType.TEXT) {
          return;
        }
        if (message.senderId == chat.clientId) {
          clientWordCount += StringUtil.wordCount(message.content);
          transcript += `Client: ${message.content}\n`;
        } else {
          counselorWordCount += StringUtil.wordCount(message.content);
          transcript += `Counselor: ${message.content}\n`;
        }
      });
      const clientTalkingPercentage =
        clientWordCount > 0
          ? parseFloat(
              (
                clientWordCount /
                (clientWordCount + counselorWordCount)
              ).toFixed(3),
            )
          : 0;
      const counselorTalkingPercentage =
        counselorWordCount > 0
          ? parseFloat(
              (
                counselorWordCount /
                (clientWordCount + counselorWordCount)
              ).toFixed(3),
            )
          : 0;

      if (!callDetails) {
        callDetails = await this.callDetailsRepository.findOne({
          where: { chatId, tenantId: ExecutionManager.getTenantId() },
        });
      }

      const existingCallInfo = callDetails?.callInfo || {};

      const encryptedTranscript = await this.cryptoService.encrypt(
        transcript,
        this.config.phiData?.phiDataEncryptionKey,
      );

      const updates = {
        noOfNudges,
        noOfStages,
        transcript: encryptedTranscript,
        callInfo: {
          ...existingCallInfo,
          clientTalkingPercentage: clientTalkingPercentage,
          counselorTalkingPercentage: counselorTalkingPercentage,
          clientTalkingTime: clientTalkingPercentage * callDurationInSeconds,
          counselorTalkingTime:
            counselorTalkingPercentage * callDurationInSeconds,
          ...(!existingCallInfo.summaryName
            ? { summaryName: ChatUtil.getSummaryName(chat) }
            : {}),
          wordCountByLanguage,
          clientWordCount,
          counselorWordCount,
        } as CallInfo,
        endTime: endDate,
        callDuration: callDurationInSeconds,
      };
      this.logger.debug(
        `updateMessageStatistics:updates:${JSON.stringify(updates)}`,
      );
      const details = await this.callDetailsRepository.update(
        { chatId },
        updates,
      );
      // delete the word count from cache
      await this.deleteWordCountByLanguage(chat.id);
      this.logger.debug(`updateMessageStatistics:End - chatId:${chat.id}`);
      return details;
    } catch (err) {
      this.logger.error(
        `updateMessageStatistics - chatId:${chat.id} - error:${err}`,
      );
    }
  }

  async generateSummary(
    chatId: number,
  ): Promise<FlattenedSummaryNotePayloadCamelCase | undefined> {
    this.logger.debug(`generateSummary - chatId:${chatId}`);
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new NotFoundException('User not found');
    }
    const chat = await this.chatRepository.findOne({
      where: {
        counselorId: userId,
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    if (!chat) {
      throw new NotFoundException(`Chat not found`);
    }
    const messageRequests =
      await this.messageService.getChatHistoryForAIService(chatId, {
        sortBy: 'createdAt',
        order: 'ASC',
      });
    const aiResponse =
      await this.aiService.generateSummaryAndTags(messageRequests);
    const convertedResponse = this.convertToCamelCase(
      aiResponse,
    ) as FlattenedSummaryNotePayloadCamelCase;

    return convertedResponse;
  }

  async updateCallDetails(
    chatId: number,
    summary: FlattenedSummaryNotePayloadCamelCase,
  ) {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new NotFoundException('User not found');
    }
    const chat = await this.chatRepository.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
        counselorId: userId,
      },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    if (summary.sessionSummary) {
      summary.sessionSummary = await this.cryptoService.encrypt(
        summary.sessionSummary,
        this.config.phiData?.phiDataEncryptionKey,
      );
    }

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { summary },
    );
  }

  async updateCallInfo(chatId: number, body: CallInfoDto, chat: Chat) {
    const currentUserId = ExecutionManager.getUserId();
    if (!currentUserId) {
      throw new ForbiddenException('User not authenticated');
    }

    if (chat.counselorId !== parseInt(currentUserId)) {
      throw new ForbiddenException(
        'You are not authorized to update call info for this chat',
      );
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }
    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: { ...callDetails.callInfo, summaryName: body.summaryName } },
    );
  }

  incrementWordCountByLanguage(
    chatId: number,
    language: string,
    count: number,
  ) {
    const key = this.getWordCountKey(chatId);
    return this.cache.hincrBy(key, language, count);
  }

  private async getWordCountByLanguage(chatId: number) {
    const key = this.getWordCountKey(chatId);
    const rawCounts = await this.cache.hgetAll(key);
    return Object.entries(rawCounts).reduce(
      (acc, [lang, count]) => {
        acc[lang] = parseInt(count, 10);
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  private async deleteWordCountByLanguage(chatId: number) {
    const key = this.getWordCountKey(chatId);
    await this.cache.del(key);
  }

  private getWordCountKey(chatId: number) {
    return `call:${chatId}:word-count`;
  }

  async decryptCallDetails(
    callDetails: CallDetails | null,
  ): Promise<CallDetails | undefined> {
    if (!callDetails) return undefined;

    const decryptedCallDetails = { ...callDetails };

    try {
      if (decryptedCallDetails.transcript) {
        decryptedCallDetails.transcript = await this.cryptoService.decrypt(
          decryptedCallDetails.transcript,
          this.config.phiData?.phiDataEncryptionKey,
        );
      }

      if (decryptedCallDetails.summary?.sessionSummary) {
        const decryptedSummary = await this.cryptoService.decrypt(
          decryptedCallDetails.summary.sessionSummary,
          this.config.phiData?.phiDataEncryptionKey,
        );
        decryptedCallDetails.summary.sessionSummary = decryptedSummary;
      }

      return decryptedCallDetails as CallDetails;
    } catch (error) {
      this.logger.error(
        `Failed to decrypt call details: ${JSON.stringify(error)}`,
      );
      decryptedCallDetails.transcript = '';
      if (decryptedCallDetails.summary?.sessionSummary) {
        decryptedCallDetails.summary.sessionSummary = '';
      }
      return decryptedCallDetails as CallDetails;
    }
  }

  async pauseOrResumeChat(chatId: number, pause: boolean) {
    const callDetails = await this.callDetailsRepository.findOne({
      where: {
        chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }

    const updatedCallInfo = {
      ...callDetails.callInfo,
      pauseChat: pause,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );
    await this.cache.set(
      `chat-paused-${chatId}`,
      String(pause),
      TIME.DAY_IN_SECONDS,
    );
  }

  async isChatPaused(chatId: number) {
    const cachedValue = await this.cache.get(`chat-paused-${chatId}`);
    if (cachedValue) {
      return cachedValue === 'true';
    }
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    const isPaused = callDetails?.callInfo?.pauseChat;
    if (isPaused !== undefined) {
      await this.cache.set(
        `chat-paused-${chatId}`,
        String(isPaused),
        TIME.DAY_IN_SECONDS,
      );
    }
    return isPaused;
  }

  // Helper method to convert to camel case (from CommonUtil)
  private convertToCamelCase(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertToCamelCase(item));
    } else if (obj !== null && typeof obj === 'object') {
      return Object.keys(obj).reduce((acc, key) => {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) =>
          letter.toUpperCase(),
        );
        acc[camelKey] = this.convertToCamelCase(obj[key]);
        return acc;
      }, {} as any);
    }
    return obj;
  }

  private async getChatById(chatId: number): Promise<Chat | null> {
    return this.chatRepository.findOne({
      where: {
        id: chatId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
  }
}
