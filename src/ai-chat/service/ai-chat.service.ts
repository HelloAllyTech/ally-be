import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LlmProviderFactory } from '../provider/llm-provider.factory';
import {
  LlmMessage,
  LlmProviderConfig,
} from '../interface/llm-provider.interface';
import { AppConfigService } from 'src/config/config.service';

export interface SseMessageEvent {
  data: string;
}

@Injectable()
export class AiChatService {
  constructor(
    private readonly llmProviderFactory: LlmProviderFactory,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Streams an LLM response given a system prompt, chat history, and user message.
   * Returns an Observable<MessageEvent> for SSE streaming.
   *
   * @param onComplete — called with the full response text when streaming finishes.
   *                     The domain consumer uses this to persist the assistant message.
   */
  streamResponse(params: {
    systemPrompt: string;
    chatHistory: LlmMessage[];
    userMessage: string;
    llmConfig: LlmProviderConfig;
    providerType?: string;
    onComplete?: (fullResponse: string) => Promise<void>;
  }): Observable<SseMessageEvent> {
    const subject = new Subject<SseMessageEvent>();

    this.executeStream(subject, params).catch((err) => {
      subject.next({
        data: JSON.stringify({ type: 'error', error: err.message }),
      });
      subject.complete();
    });

    return subject.asObservable();
  }

  private async executeStream(
    subject: Subject<SseMessageEvent>,
    params: {
      systemPrompt: string;
      chatHistory: LlmMessage[];
      userMessage: string;
      llmConfig: LlmProviderConfig;
      providerType?: string;
      onComplete?: (fullResponse: string) => Promise<void>;
    },
  ): Promise<void> {
    const { systemPrompt, chatHistory, userMessage, llmConfig } = params;

    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userMessage },
    ];

    const maxContextTokens = this.configService.aiChat.maxContextTokens;
    const prunedMessages = this.pruneMessages(messages, maxContextTokens);

    const provider = this.llmProviderFactory.getProvider(params.providerType);
    let fullResponse = '';
    let streamCompleted = false;

    try {
      for await (const chunk of provider.streamCompletion(
        prunedMessages,
        llmConfig,
      )) {
        fullResponse += chunk.content;
        subject.next({
          data: JSON.stringify({ type: 'token', content: chunk.content }),
        });
      }
      streamCompleted = true;
    } catch {
      subject.next({
        data: JSON.stringify({
          type: 'error',
          error: 'Response interrupted. Please try again.',
        }),
      });
    }

    if (streamCompleted && fullResponse.length > 0) {
      if (params.onComplete) {
        await params.onComplete(fullResponse);
      }
      subject.next({ data: JSON.stringify({ type: 'done' }) });
    }

    subject.complete();
  }

  private pruneMessages(
    messages: LlmMessage[],
    maxTokens: number,
    maxHistoryMessages = 10,
  ): LlmMessage[] {
    const systemPrompt = messages[0];
    const userMessage = messages[messages.length - 1];
    let history = messages.slice(1, -1);

    if (history.length > maxHistoryMessages) {
      history = history.slice(-maxHistoryMessages);
    }

    const pruned = [systemPrompt, ...history, userMessage];

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    let total = pruned.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    while (total > maxTokens && pruned.length > 2) {
      const removed = pruned.splice(1, 1)[0];
      total -= estimateTokens(removed.content);
    }

    return pruned;
  }
}
