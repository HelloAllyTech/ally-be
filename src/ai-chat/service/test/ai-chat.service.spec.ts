import { lastValueFrom, toArray } from 'rxjs';

import { AiChatService } from '../ai-chat.service';
import {
  LlmProvider,
  LlmStreamChunk,
} from '../../interface/llm-provider.interface';
import { LlmTask } from 'src/learn/enum/llm-task.enum';

/**
 * The debrief chat recorded no `llm_usage` at all before, so its spend was
 * missing from every session's cost. These pin that it now records exactly
 * once per call, against the session it is about — and never breaks the chat.
 */
describe('AiChatService usage recording', () => {
  const config = {
    aiChat: { maxContextTokens: 8000, defaultProvider: 'openai' },
  } as any;

  const makeService = (provider: Partial<LlmProvider>) => {
    const record = jest.fn().mockResolvedValue(undefined);
    const service = new AiChatService(
      { getProvider: () => provider } as any,
      config,
      { record } as any,
    );
    return { service, record };
  };

  async function* chunks(
    ...items: LlmStreamChunk[]
  ): AsyncIterable<LlmStreamChunk> {
    for (const c of items) yield c;
  }

  const stream = (service: AiChatService, usage?: any) =>
    lastValueFrom(
      service
        .streamResponse({
          systemPrompt: 'sys',
          chatHistory: [],
          userMessage: 'How did I do?',
          llmConfig: { model: 'gpt-4o-mini' },
          usage,
        })
        .pipe(toArray()),
    );

  it('records the streamed reply against the session, once', async () => {
    const { service, record } = makeService({
      streamCompletion: () =>
        chunks(
          { content: 'Well ' },
          { content: 'done.' },
          { content: '', usage: { promptTokens: 120, completionTokens: 8 } },
        ),
    });

    const events = await stream(service, {
      task: LlmTask.DEBRIEF_CHAT,
      scenarioSessionId: 'sess-1',
      tenantId: 't-1',
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: LlmTask.DEBRIEF_CHAT,
        provider: 'openai',
        model: 'gpt-4o-mini',
        promptTokens: 120,
        completionTokens: 8,
        scenarioSessionId: 'sess-1',
        tenantId: 't-1',
      }),
    );
    // The usage chunk carries no text, so it must not reach the client.
    const tokens = events
      .map((e) => JSON.parse(e.data))
      .filter((d) => d.type === 'token');
    expect(tokens.map((t) => t.content)).toEqual(['Well ', 'done.']);
  });

  it('records nothing without an attribution', async () => {
    const { service, record } = makeService({
      streamCompletion: () =>
        chunks(
          { content: 'hi' },
          { content: '', usage: { promptTokens: 1, completionTokens: 1 } },
        ),
    });

    await stream(service);

    expect(record).not.toHaveBeenCalled();
  });

  it('records the summarisation call through getCompletion', async () => {
    const { service, record } = makeService({
      getCompletion: jest.fn(async (_m, _c, onUsage) => {
        onUsage?.({ promptTokens: 300, completionTokens: 40 });
        return 'summary';
      }),
    });

    const out = await service.summarizeMessages({
      existingSummary: null,
      messages: [{ role: 'user', content: 'x' }],
      llmConfig: { model: 'gpt-4o-mini' },
      usage: {
        task: LlmTask.DEBRIEF_CHAT_SUMMARY,
        scenarioSessionId: 'sess-1',
      },
    });

    expect(out).toBe('summary');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: LlmTask.DEBRIEF_CHAT_SUMMARY,
        promptTokens: 300,
        completionTokens: 40,
        scenarioSessionId: 'sess-1',
      }),
    );
  });
});
