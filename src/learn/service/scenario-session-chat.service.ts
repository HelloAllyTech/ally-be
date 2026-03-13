import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Observable, Subject, startWith } from 'rxjs';
import { In } from 'typeorm';
import {
  AiChatService,
  SseMessageEvent,
} from 'src/ai-chat/service/ai-chat.service';
import { LlmMessage } from 'src/ai-chat/interface/llm-provider.interface';
import { AppConfigService } from 'src/config/config.service';
import { ScenarioSessionChatRepository } from '../repository/scenario-session-chat.repository';
import { ScenarioSessionChatMessageRepository } from '../repository/scenario-session-chat-message.repository';
import { ScenarioSessionContextProvider } from './scenario-session-context.provider';
import { ScenarioSessionChat } from '../entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../entity/scenario-session-chat-message.entity';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  CHAT_HISTORY_WINDOW_SIZE,
  CHAT_SUMMARIZATION_BATCH_THRESHOLD,
} from '../constants/scenario-session-chat.constants';
import { extractTimestampsFromText } from 'src/common/util/time.util';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { formatSecondsToMMSS } from 'src/common/util/time.util';
import { ScenarioSessionMessages } from '../entity/scenario-session-messages.entity';
import {
  CitationResponse,
  SessionChatHistoryResponse,
  StreamEventType,
} from '../type/scenario-session-chat.type';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class ScenarioSessionChatService {
  private readonly logger = LoggerService.getInstance(
    ScenarioSessionChatService.name,
  );
  constructor(
    private readonly chatRepo: ScenarioSessionChatRepository,
    private readonly chatMessageRepo: ScenarioSessionChatMessageRepository,
    private readonly contextProvider: ScenarioSessionContextProvider,
    private readonly aiChatService: AiChatService,
    private readonly configService: AppConfigService,
    private readonly scenarioSessionMessageRepo: ScenarioSessionMessagesRepository,
  ) {}

  async streamChat(
    scenarioSessionId: string,
    userId: number,
    userMessage: string,
  ): Promise<Observable<SseMessageEvent>> {
    this.logger.info(
      `Starting stream chat for scenarioSessionId: ${scenarioSessionId}, userId: ${userId}`,
    );
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      this.logger.error('Tenant ID is required but not found');
      throw new InternalServerErrorException('Tenant ID is required');
    }

    const chat = await this.findOrCreateChat(
      scenarioSessionId,
      userId,
      tenantId,
    );

    await this.chatMessageRepo.save({
      chatId: chat.id,
      senderId: userId,
      content: userMessage,
      tenantId,
    });
    this.logger.debug(
      `User message saved for chatId: ${chat.id}, message length: ${userMessage.length}`,
    );

    const allMessages = await this.chatMessageRepo.find({
      where: { chatId: chat.id },
      order: { createdAt: 'ASC' },
    });

    const chatHistory = await this.buildChatHistoryWithSummarization(
      chat,
      allMessages,
    );

    const context = await this.contextProvider.buildContext(scenarioSessionId);

    // Get transcript messages for citation lookup
    const transcriptMessages = context?.metadata?.transcriptMessages ?? [];
    this.logger.debug(
      `Retrieved ${transcriptMessages.length} transcript messages for citation lookup`,
    );

    const subject = new Subject<SseMessageEvent>();
    let fullResponse = '';

    // Stream the response
    this.logger.debug(`Starting AI stream response for chatId: ${chat.id}`);
    const streamObservable = this.aiChatService.streamResponse({
      systemPrompt: context.systemPrompt,
      chatHistory,
      userMessage,
      llmConfig: {
        model: this.configService.aiChat.model,
        temperature: this.configService.aiChat.temperature,
        maxTokens: this.configService.aiChat.maxTokens,
      },
    });

    streamObservable.subscribe({
      next: async (event) => {
        try {
          const eventData = JSON.parse(event.data);

          if (eventData.type === StreamEventType.TOKEN) {
            fullResponse += eventData.content;

            // Forward token events
            subject.next({
              data: JSON.stringify({
                type: StreamEventType.TOKEN,
                content: eventData.content,
              }),
            });
          } else if (eventData.type === StreamEventType.DONE) {
            const timestamps = extractTimestampsFromText(fullResponse);
            this.logger.debug(
              `Stream completed. Extracted ${timestamps.length} timestamps from response. Response length: ${fullResponse.length}`,
            );
            // Process citations after stream completes, then send done event
            const citations = this.processCitations(
              timestamps,
              transcriptMessages,
              subject,
            );
            const citationTranscriptIds = citations.map((c) => c.transcriptId);
            this.logger.debug(
              `Processed ${citations.length} unique citations with ${citationTranscriptIds.length} transcript IDs`,
            );
            // Send done event with full response and citations
            subject.next({
              data: JSON.stringify({
                type: StreamEventType.DONE,
                content: fullResponse,
                citations,
              }),
            });
            subject.complete();
            this.logger.info(
              `Successfully sent DONE event with ${citations.length} citations for chatId: ${chat.id}`,
            );
            try {
              await this.chatMessageRepo.save({
                chatId: chat.id,
                senderId: -1,
                content: fullResponse,
                citationTranscriptIds,
                tenantId,
              });
              this.logger.debug(
                `Successfully saved assistant message with ${citationTranscriptIds.length} citation transcript IDs for chatId: ${chat.id}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to save chat message with citations for chatId: ${chat.id}`,
                error,
              );
            }
          } else if (eventData.type === StreamEventType.ERROR) {
            this.logger.error(
              `Stream error received for chatId: ${chat.id}`,
              eventData,
            );
            subject.next(event);
            subject.complete();
          }
        } catch (error) {
          // If parsing fails, forward as-is
          this.logger.warn(
            `Failed to parse event data for chatId: ${chat.id}`,
            error,
          );
          subject.next(event);
        }
      },
      error: (error) => {
        this.logger.error(
          `Stream observable error for chatId: ${chat.id}`,
          error,
        );
        subject.next({
          data: JSON.stringify({
            type: StreamEventType.ERROR,
            error: error.message || 'An error occurred',
          }),
        });
        subject.complete();
      },
    });

    // Return observable with start event prepended
    // Use startWith to ensure start event is the first event when subscribed
    return subject.pipe(
      startWith({
        data: JSON.stringify({ type: StreamEventType.START }),
      } as SseMessageEvent),
    );
  }

  private processCitations(
    timestamps: number[],
    transcriptMessages: ScenarioSessionMessages[],
    subject: Subject<SseMessageEvent>,
  ): CitationResponse[] {
    const citations: CitationResponse[] = [];

    if (timestamps.length === 0) {
      this.logger.debug('No timestamps found, sending empty citations event');
      // Send empty citations event
      subject.next({
        data: JSON.stringify({
          type: StreamEventType.CITATIONS,
          citations: [],
        }),
      });
      return [];
    }

    this.logger.debug(
      `Processing ${timestamps.length} timestamps against ${transcriptMessages.length} transcript messages`,
    );

    for (const timestampSeconds of timestamps) {
      const targetFormattedTimestamp = formatSecondsToMMSS(timestampSeconds);
      const matchingMessage = transcriptMessages.find((msg) => {
        if (msg.startSeconds == null) return false;
        const msgFormattedTimestamp = formatSecondsToMMSS(msg.startSeconds);
        return msgFormattedTimestamp === targetFormattedTimestamp;
      });

      if (matchingMessage) {
        const formattedTimestamp = formatSecondsToMMSS(
          matchingMessage.startSeconds,
        );
        citations.push({
          timestamp: formattedTimestamp,
          content: matchingMessage.content,
          senderId: matchingMessage.senderId,
          transcriptId: matchingMessage.id,
        });
      }
    }

    // Remove duplicates based on transcriptId
    const uniqueCitationResponse = Array.from(
      new Map(citations.map((c) => [c.transcriptId, c])).values(),
    );

    // Send citations event
    subject.next({
      data: JSON.stringify({
        type: StreamEventType.CITATIONS,
        citations: uniqueCitationResponse,
      }),
    });

    return uniqueCitationResponse;
  }

  /**
   * Splits messages into three zones (summarized / overflow / window),
   * triggers batch summarization when overflow exceeds the threshold,
   * and returns a bounded chat history for the LLM.
   */
  private async buildChatHistoryWithSummarization(
    chat: ScenarioSessionChat,
    allMessages: ScenarioSessionChatMessage[],
  ): Promise<LlmMessage[]> {
    const total = allMessages.length;
    const windowStart = Math.max(0, total - CHAT_HISTORY_WINDOW_SIZE);
    const overflowStart = chat.summarizedMessageCount;
    const overflowEnd = windowStart;

    let overflowMessages = allMessages.slice(overflowStart, overflowEnd);
    const windowMessages = allMessages.slice(windowStart);

    if (overflowMessages.length >= CHAT_SUMMARIZATION_BATCH_THRESHOLD) {
      this.logger.debug(
        `Triggering summarization for chatId: ${chat.id}, overflow messages: ${overflowMessages.length}`,
      );
      const overflowAsLlm = this.toLlmMessages(overflowMessages);

      const newSummary = await this.aiChatService.summarizeMessages({
        existingSummary: chat.summary ?? null,
        messages: overflowAsLlm,
        llmConfig: { model: this.configService.aiChat.model },
      });

      chat.summary = newSummary;
      chat.summarizedMessageCount = overflowEnd;
      await this.chatRepo.update(chat.id, {
        summary: newSummary,
        summarizedMessageCount: overflowEnd,
      });

      this.logger.debug(
        `Successfully summarized ${overflowMessages.length} messages for chatId: ${chat.id}`,
      );
      overflowMessages = [];
    }

    const chatHistory: LlmMessage[] = [];

    if (chat.summary) {
      chatHistory.push({
        role: 'system',
        content: `Summary of earlier conversation:\n${chat.summary}`,
      });
    }

    chatHistory.push(...this.toLlmMessages(overflowMessages));
    chatHistory.push(...this.toLlmMessages(windowMessages));

    return chatHistory;
  }

  private toLlmMessages(messages: ScenarioSessionChatMessage[]): LlmMessage[] {
    return messages.map((message) => ({
      role: (message.senderId === -1
        ? 'assistant'
        : 'user') as LlmMessage['role'],
      content: message.content,
    }));
  }

  async getChatHistory(
    scenarioSessionId: string,
    userId: number,
  ): Promise<SessionChatHistoryResponse[]> {
    this.logger.debug(
      `Getting chat history for scenarioSessionId: ${scenarioSessionId}, userId: ${userId}`,
    );
    const chat = await this.chatRepo.findOne({
      where: { scenarioSessionId, userId },
    });

    if (!chat) {
      this.logger.debug(
        `No chat found for scenarioSessionId: ${scenarioSessionId}, userId: ${userId}`,
      );
      return [];
    }

    const messages = await this.chatMessageRepo.find({
      where: { chatId: chat.id },
      order: { createdAt: 'ASC' },
    });

    this.logger.debug(
      `Retrieved ${messages.length} messages for chatId: ${chat.id}`,
    );

    // Collect all unique transcript IDs from all messages
    const allTranscriptIds = new Set<number>();
    messages.forEach((m) => {
      if (m.citationTranscriptIds && m.citationTranscriptIds.length > 0) {
        m.citationTranscriptIds.forEach((id) => allTranscriptIds.add(id));
      }
    });

    // Fetch only the referenced transcripts
    const transcriptMessagesMap = new Map<number, ScenarioSessionMessages>();
    if (allTranscriptIds.size > 0) {
      this.logger.debug(
        `Fetching ${allTranscriptIds.size} unique transcript messages for citations`,
      );
      const transcriptIdsArray = Array.from(allTranscriptIds);
      const transcriptMessages = await this.scenarioSessionMessageRepo.find({
        where: {
          scenarioSessionId,
          id: In(transcriptIdsArray),
        },
      });
      this.logger.debug(
        `Retrieved ${transcriptMessages.length} transcript messages for citations`,
      );
      transcriptMessages.forEach((tm) => {
        transcriptMessagesMap.set(tm.id, tm);
      });
    }

    return messages.map((m) => {
      const result: SessionChatHistoryResponse = {
        id: m.id,
        content: m.content,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        citations: [],
        role: m.senderId === -1 ? 'assistant' : 'user',
      };

      // Add citations if present
      if (m.citationTranscriptIds && m.citationTranscriptIds.length > 0) {
        result.citations = m.citationTranscriptIds
          .map((transcriptId) => {
            const transcript = transcriptMessagesMap.get(transcriptId);
            if (!transcript) return null;
            const timestamp = formatSecondsToMMSS(transcript.startSeconds);
            return {
              timestamp: timestamp || null,
              content: transcript.content,
              senderId: transcript.senderId,
              transcriptId,
            };
          })
          .filter((citation) => citation !== null);
      }

      return result;
    });
  }

  private async findOrCreateChat(
    scenarioSessionId: string,
    userId: number,
    tenantId: string,
  ): Promise<ScenarioSessionChat> {
    let chat = await this.chatRepo.findOne({
      where: { scenarioSessionId, userId },
    });

    if (!chat) {
      chat = await this.chatRepo.save({
        scenarioSessionId,
        userId,
        tenantId,
      });
      this.logger.debug(`Created new chat with id: ${chat.id}`);
    } else {
      this.logger.debug(
        `Found existing chat with id: ${chat.id} for scenarioSessionId: ${scenarioSessionId}, userId: ${userId}`,
      );
    }

    return chat;
  }
}
