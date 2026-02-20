import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Observable } from 'rxjs';
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

@Injectable()
export class ScenarioSessionChatService {
  constructor(
    private readonly chatRepo: ScenarioSessionChatRepository,
    private readonly chatMessageRepo: ScenarioSessionChatMessageRepository,
    private readonly contextProvider: ScenarioSessionContextProvider,
    private readonly aiChatService: AiChatService,
    private readonly configService: AppConfigService,
  ) {}

  async streamChat(
    scenarioSessionId: string,
    userId: number,
    userMessage: string,
  ): Promise<Observable<SseMessageEvent>> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
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

    const allMessages = await this.chatMessageRepo.find({
      where: { chatId: chat.id },
      order: { createdAt: 'ASC' },
    });

    const chatHistory = await this.buildChatHistoryWithSummarization(
      chat,
      allMessages,
    );

    const context = await this.contextProvider.buildContext(scenarioSessionId);

    return this.aiChatService.streamResponse({
      systemPrompt: context.systemPrompt,
      chatHistory,
      userMessage,
      llmConfig: {
        model: this.configService.aiChat.model,
        temperature: this.configService.aiChat.temperature,
        maxTokens: this.configService.aiChat.maxTokens,
      },
      onComplete: async (fullResponse: string) => {
        await this.chatMessageRepo.save({
          chatId: chat.id,
          senderId: -1,
          content: fullResponse,
          tenantId,
        });
      },
    });
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

  async getChatHistory(scenarioSessionId: string, userId: number) {
    const chat = await this.chatRepo.findOne({
      where: { scenarioSessionId, userId },
    });

    if (!chat) {
      return [];
    }

    const messages = await this.chatMessageRepo.find({
      where: { chatId: chat.id },
      order: { createdAt: 'ASC' },
    });

    return messages.map((m) => ({
      id: m.id,
      role: m.senderId === -1 ? 'assistant' : 'user',
      content: m.content,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
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
    }

    return chat;
  }
}
