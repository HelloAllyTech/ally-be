import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { CryptoService } from '../../common/service/crypto.service';
import { AppConfigService } from '../../config/config.service';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { ChatRepository } from '../repository/chat.repository';
import { MessageService } from './message.service';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { ChatAudioUploadsService } from '../../audio/service/chat-audio-uploads.service';
import { AiService } from '../../ai/service/ai.service';
import { RedisService } from '../../redis/service/redis.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { CallInfoDto } from '../dto/chat.response.dto';
import { ChatUtil } from '../util/chat.util';
import { StringUtil } from '../../common/util/string.util';
import {
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import { findMessageBrokerChannelUsingProvider } from '../../common/util/chat-types.util';
import { TIME } from '../../common/constants/time.constants';
import { ForbiddenException } from '../../exception/custom.exception';
import { Raw, MoreThanOrEqual } from 'typeorm';
import { Chat, ChatSummaryStatus } from '../entity/chat.entity';
import { MessageType } from '../entity/message.entity';
import {
  SUMMARY_RETRY_MAX_ATTEMPTS,
  SUMMARY_RETRY_LOOKBACK_DAYS,
} from '../constants/chat.constants';
import { FlattenedSummaryNotePayloadCamelCase } from '../type/call.details.type';
import { CallInfo } from '../dto/call-log.response.dto';
import { CallDetails } from '../entity/call.details.entity';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { CustomFieldsService } from '../../custom-fields/service/custom-fields.service';

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
    private customFieldsService: CustomFieldsService,
    private chatAudioUploadsService: ChatAudioUploadsService,
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
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chat.id, tenantId: ExecutionManager.getTenantId() },
    });
    const summary: any = (await this.generateSummary(chat.id)) || {};
    summary.mode = callDetails?.callInfo?.mode ?? ScribeSessionMode.SCRIBE;

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

    await this.fillAiCustomFields(chat, chat.tenantId);
  }

  /**
   * Regenerate the summary (and AI custom fields) from the chat's STORED
   * transcript and persist it. No audio or re-transcription needed — this is
   * the shared engine behind both the manual retry endpoint and the cron.
   * Tenant is taken from the chat so it works without a request context.
   * Throws if there is no transcript to summarise.
   */
  private async regenerateSummaryFromTranscript(chat: Chat): Promise<void> {
    const tenantId = chat.tenantId;
    const messages = await this.messageService.getChatHistoryForAIService(
      chat.id,
      { sortBy: 'createdAt', order: 'ASC' },
      tenantId,
    );
    if (!messages?.length) {
      throw new Error('No transcript available to summarise');
    }

    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId: chat.id, tenantId },
    });
    const mode = callDetails?.callInfo?.mode;

    const aiResponse = await this.aiService.generateSummaryAndTags(
      messages,
      mode,
    );
    const summary: any = this.convertToCamelCase(aiResponse) ?? {};
    summary.mode = mode ?? ScribeSessionMode.SCRIBE;
    if (summary.sessionSummary) {
      summary.sessionSummary = await this.cryptoService.encrypt(
        summary.sessionSummary,
        this.config.phiData?.phiDataEncryptionKey,
      );
    }

    await this.callDetailsRepository.update({ chatId: chat.id }, { summary });
    await this.fillAiCustomFields(chat, tenantId);
  }

  /**
   * Status transitions + attempt tracking around a single summary retry.
   * Shared by the manual endpoint and the cron.
   */
  private async runSummaryRetry(
    chat: Chat,
  ): Promise<{ success: boolean; message: string }> {
    const chatId = chat.id;
    const metadata = (chat.metadata as Record<string, any>) ?? {};

    await this.chatRepository.update(chatId, {
      summaryStatus: ChatSummaryStatus.IN_PROGRESS,
    });

    try {
      await this.regenerateSummaryFromTranscript(chat);
      await this.chatRepository.update(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
        metadata: { ...metadata, summaryRetryable: false } as Record<
          string,
          any
        >,
      });
      this.logger.info(`Summary retry succeeded for chat ${chatId}`);
      // Summary is final — drop the recording now that recovery is no longer
      // needed. Best-effort.
      if (!this.config.isDevelopment) {
        try {
          await this.chatAudioUploadsService.cleanupStoredAudio(chatId);
        } catch (err) {
          this.logger.error(
            `Failed to delete stored audio after summary retry for chat ${chatId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      return { success: true, message: 'Summary generated' };
    } catch (err) {
      const attempts = (Number(metadata.summaryRetryAttempts) || 0) + 1;
      const reason = err instanceof Error ? err.message : String(err);
      await this.chatRepository.update(chatId, {
        summaryStatus: ChatSummaryStatus.FAILED,
        metadata: {
          ...metadata,
          summaryRetryable: true,
          summaryRetryAttempts: attempts,
          error: reason,
        } as Record<string, any>,
      });
      this.logger.error(
        `Summary retry failed for chat ${chatId} (attempt ${attempts}): ${reason}`,
      );
      return { success: false, message: reason };
    }
  }

  /**
   * Manual "Retry summary" action (tenant-scoped to the caller). Regenerates
   * the summary from the saved transcript for a chat whose summary previously
   * failed.
   */
  async retrySummary(
    chatId: number,
  ): Promise<{ success: boolean; message: string; needsReprocess?: boolean }> {
    const tenantId = ExecutionManager.getTenantId();
    const chat = await this.chatRepository.findOne({
      where: { id: chatId, tenantId },
    });
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    if (chat.summaryStatus === ChatSummaryStatus.SUCCESS) {
      return { success: true, message: 'Summary already generated' };
    }

    // No stored transcript means transcription itself never came back — there
    // is nothing to summarise from. Signal the caller to recover by
    // re-transcribing from the stored audio instead of looping summary retries.
    const messages = await this.messageService.getChatHistoryForAIService(
      chatId,
      { sortBy: 'createdAt', order: 'ASC' },
      tenantId,
    );
    if (!messages?.length) {
      return {
        success: false,
        message: 'No transcript available; re-transcription required',
        needsReprocess: true,
      };
    }

    return this.runSummaryRetry(chat);
  }

  /**
   * Chats whose transcript was saved but summary failed and that are still
   * within the auto-retry budget (created recently, under the attempt cap).
   */
  private async findRetryableSummaryChats(): Promise<Chat[]> {
    const lookbackCutoff = new Date(
      Date.now() - SUMMARY_RETRY_LOOKBACK_DAYS * TIME.DAY_IN_MS,
    );
    return this.chatRepository.find({
      where: {
        summaryStatus: ChatSummaryStatus.FAILED,
        createdAt: MoreThanOrEqual(lookbackCutoff),
        metadata: Raw(
          (alias) =>
            `${alias} ->> 'summaryRetryable' = 'true' AND ` +
            `COALESCE((${alias} ->> 'summaryRetryAttempts')::int, 0) < :maxAttempts`,
          { maxAttempts: SUMMARY_RETRY_MAX_ATTEMPTS },
        ),
      },
    });
  }

  /**
   * Cron: auto-retry summary generation for chats that have a transcript but a
   * failed summary, up to SUMMARY_RETRY_MAX_ATTEMPTS. Beyond that they stay
   * FAILED and wait for a manual retry.
   */
  async retryFailedSummaries(): Promise<void> {
    const chats = await this.findRetryableSummaryChats();
    if (chats.length === 0) return;

    this.logger.info(
      `Summary retry cron: attempting ${chats.length} chat(s) with failed summaries`,
    );

    for (const chat of chats) {
      // Runs outside a request; set tenant/user context for any downstream
      // reads that rely on it.
      ExecutionManager.setAuthContext(
        chat.counselorId ? chat.counselorId.toString() : '',
        chat.tenantId,
      );
      try {
        await this.runSummaryRetry(chat);
      } catch (err) {
        this.logger.error(
          `Summary retry cron failed for chat ${chat.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async fillAiCustomFields(chat: Chat, tenantId: string) {
    try {
      const aiDefinitions =
        await this.customFieldsService.getAiDefinitions(tenantId);
      this.logger.info(
        `fillAiCustomFields: chatId=${chat.id} tenantId=${tenantId} aiDefinitions=${aiDefinitions.length}`,
      );
      if (aiDefinitions.length === 0) return;

      const messageRequests =
        await this.messageService.getChatHistoryForAIService(
          chat.id,
          {
            sortBy: 'createdAt',
            order: 'ASC',
          },
          tenantId,
        );
      this.logger.info(
        `fillAiCustomFields: chatId=${chat.id} messages=${messageRequests.length}`,
      );

      const keys = aiDefinitions.map((d) => `custom_${d.id}`);
      const keyDescriptions: Record<string, string> = {};
      for (const d of aiDefinitions) {
        keyDescriptions[`custom_${d.id}`] = d.aiInstruction
          ? `${d.name}. ${d.aiInstruction}`
          : d.name;
      }

      const aiResponse = await this.aiService.generateSummaryAndTags(
        messageRequests,
        undefined,
        keys,
        keyDescriptions,
      );
      this.logger.info(
        `fillAiCustomFields: chatId=${chat.id} aiResponse=${JSON.stringify(aiResponse)}`,
      );

      if (!aiResponse || !('fields' in aiResponse)) {
        this.logger.info(
          `fillAiCustomFields: chatId=${chat.id} no fields in response`,
        );
        return;
      }

      const values = aiDefinitions
        .filter((d) => (aiResponse as any).fields[`custom_${d.id}`] != null)
        .map((d) => ({
          fieldDefinitionId: d.id,
          value: String((aiResponse as any).fields[`custom_${d.id}`]),
        }));
      this.logger.info(
        `fillAiCustomFields: chatId=${chat.id} saving ${values.length} values`,
      );

      await this.customFieldsService.upsertValuesInternal(
        chat.id,
        tenantId,
        values,
      );
      this.logger.info(
        `fillAiCustomFields: chatId=${chat.id} saved successfully`,
      );
    } catch (error) {
      this.logger.error(
        `fillAiCustomFields failed for chatId ${chat.id}: ${error.message}`,
      );
    }
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

      if (!callDetails) {
        callDetails = await this.callDetailsRepository.findOne({
          where: { chatId, tenantId: ExecutionManager.getTenantId() },
        });
      }

      const mode = callDetails?.callInfo?.mode ?? ScribeSessionMode.SCRIBE;
      const isDictationMode = mode === ScribeSessionMode.DICTATION;

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
          transcript += isDictationMode
            ? `${message.content} `
            : `Client: ${message.content}\n`;
        } else {
          counselorWordCount += StringUtil.wordCount(message.content);
          transcript += isDictationMode
            ? `${message.content} `
            : `Counselor: ${message.content}\n`;
        }
      });
      if (isDictationMode) {
        transcript = transcript.replace(/\s+/g, ' ').trim();
      }
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
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
    const mode = callDetails?.callInfo?.mode;

    const aiResponse = await this.aiService.generateSummaryAndTags(
      messageRequests,
      mode,
    );
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

    // A manual edit is an authoritative summary. If the chat's summary had
    // failed (transcript saved, summary retryable), mark it SUCCESS and clear
    // the retryable flag so it shows as complete AND the auto-retry cron won't
    // overwrite the counselor's hand-entered fields.
    if (chat.summaryStatus !== ChatSummaryStatus.SUCCESS) {
      const existingMetadata = (chat.metadata as Record<string, any>) ?? {};
      await this.chatRepository.update(chatId, {
        summaryStatus: ChatSummaryStatus.SUCCESS,
        metadata: { ...existingMetadata, summaryRetryable: false } as Record<
          string,
          any
        >,
      });
      this.logger.info(
        `Summary manually edited for chat ${chatId}; marked SUCCESS and cleared retryable`,
      );
    }
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
