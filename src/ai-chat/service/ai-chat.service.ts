import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { LlmProviderFactory } from '../provider/llm-provider.factory';
import {
  LlmMessage,
  LlmProviderConfig,
  LlmTokenUsage,
} from '../interface/llm-provider.interface';
import { AppConfigService } from 'src/config/config.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';

/**
 * Who a chat call's spend belongs to. When present, the call's token usage is
 * recorded to `llm_usage` under `task`; when absent, nothing is recorded (the
 * behaviour before usage recording existed, kept for any caller that has no
 * session to attribute to).
 */
export interface ChatUsageAttribution {
  task: LlmTask;
  scenarioSessionId?: string;
  tenantId?: string;
  metadata?: Record<string, any>;
}

export interface SseMessageEvent {
  data: string;
}

@Injectable()
export class AiChatService {
  constructor(
    private readonly llmProviderFactory: LlmProviderFactory,
    private readonly configService: AppConfigService,
    private readonly llmUsageService: LlmUsageService,
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
    usage?: ChatUsageAttribution;
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
      usage?: ChatUsageAttribution;
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
    let usage: LlmTokenUsage | undefined;

    try {
      for await (const chunk of provider.streamCompletion(
        prunedMessages,
        llmConfig,
      )) {
        if (chunk.usage) usage = chunk.usage;
        // The usage report rides on an empty chunk; don't send the client a
        // token event with no content.
        if (!chunk.content) continue;
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

    // Before onComplete so a failing persist cannot lose the record of a call
    // the provider has already billed. An interrupted stream normally carries no
    // usage report, so it records nothing — an understatement, not a guess.
    this.recordUsage(params.usage, params.providerType, llmConfig.model, usage);

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
    usage?: ChatUsageAttribution;
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
      (usage) =>
        this.recordUsage(
          params.usage,
          params.providerType,
          params.llmConfig.model,
          usage,
        ),
    );
  }

  /** Best-effort, fire-and-forget: usage recording never breaks a chat. */
  private recordUsage(
    attribution: ChatUsageAttribution | undefined,
    providerType: string | undefined,
    model: string,
    usage: LlmTokenUsage | undefined,
  ): void {
    if (!attribution || !usage) return;
    void this.llmUsageService.record({
      service: 'llm',
      provider: providerType ?? this.configService.aiChat.defaultProvider,
      model,
      task: attribution.task,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
      scenarioSessionId: attribution.scenarioSessionId,
      tenantId: attribution.tenantId,
      metadata: attribution.metadata,
    });
  }

  /**
   * Bounds what goes to the model: `[systemPrompt, ...history, userMessage]`.
   * The system prompt and the turn being answered are always kept.
   *
   * Leading system-role history — a caller's running summary of turns it no
   * longer sends verbatim — is pinned. It does not count toward
   * `maxHistoryMessages`, and under the token budget it is the last history to
   * go: dropping it loses every turn it covers, where dropping the oldest
   * verbatim message loses one. (Before, the summary sat at index 1, so both
   * the count cap and the budget loop discarded it first, and the debrief chat
   * paid to generate a summary the model never saw.)
   */
  private pruneMessages(
    messages: LlmMessage[],
    maxTokens: number,
    maxHistoryMessages = 10,
  ): LlmMessage[] {
    const systemPrompt = messages[0];
    const userMessage = messages[messages.length - 1];
    const history = messages.slice(1, -1);

    const firstTurn = history.findIndex((m) => m.role !== 'system');
    const pinnedEnd = firstTurn === -1 ? history.length : firstTurn;
    const pinned = history.slice(0, pinnedEnd);
    let turns = history.slice(pinnedEnd);

    if (turns.length > maxHistoryMessages) {
      turns = turns.slice(-maxHistoryMessages);
    }

    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
    let total = [systemPrompt, ...pinned, ...turns, userMessage].reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0,
    );

    // Oldest verbatim turn first; the pinned summary only once none are left.
    while (total > maxTokens && turns.length > 0) {
      total -= estimateTokens(turns.shift()!.content);
    }
    while (total > maxTokens && pinned.length > 0) {
      total -= estimateTokens(pinned.shift()!.content);
    }

    return [systemPrompt, ...pinned, ...turns, userMessage];
  }
}
