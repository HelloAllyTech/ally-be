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

  /**
   * Produces an incremental summary by folding new messages into an existing summary.
   * Used by the batch summarization strategy to keep chat history bounded.
   */
  async summarizeMessages(params: {
    existingSummary: string | null;
    messages: LlmMessage[];
    llmConfig: LlmProviderConfig;
    providerType?: string;
  }): Promise<string> {
    const systemContent = [
      'You are a conversation summarizer.',
      'Given the existing summary (if any) and new messages, produce a concise updated summary.',
      'Capture all key topics, questions asked, decisions made, advice given, and important details.',
      'Preserve anything from the existing summary that remains relevant.',
      'Write in third person (e.g. "The user asked about…", "The assistant suggested…").',
      'Keep the summary under 300 words.',
    ].join(' ');

    const parts: string[] = [];
    if (params.existingSummary) {
      parts.push(`Existing summary:\n${params.existingSummary}\n`);
    }
    parts.push('New messages:');
    for (const m of params.messages) {
      parts.push(`${m.role}: ${m.content}`);
    }

    const provider = this.llmProviderFactory.getProvider(params.providerType);
    return provider.getCompletion(
      [
        { role: 'system', content: systemContent },
        { role: 'user', content: parts.join('\n') },
      ],
      { model: params.llmConfig.model, temperature: 0.3, maxTokens: 500 },
    );
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
