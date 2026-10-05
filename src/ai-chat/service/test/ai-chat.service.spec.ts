import { lastValueFrom, toArray } from 'rxjs';

import { AiChatService } from '../ai-chat.service';
import {
  LlmMessage,
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

/**
 * The debrief chat sends [summary (system), unsummarised overflow, last 10],
 * but pruning used to keep only the last 10 history items and, over the token
 * budget, dropped index 1 first — so the summary it paid to generate never
 * reached the model. These pin what pruning keeps: the summary, then the last
 * 10 verbatim turns.
 */
describe('AiChatService history pruning', () => {
  const run = async (params: {
    chatHistory: LlmMessage[];
    maxContextTokens?: number;
  }): Promise<LlmMessage[]> => {
    let sent: LlmMessage[] = [];
    const provider: Partial<LlmProvider> = {
      streamCompletion: (messages: LlmMessage[]) => {
        sent = messages;
        return (async function* () {
          yield { content: 'ok' } as LlmStreamChunk;
        })();
      },
    };
    const service = new AiChatService(
      { getProvider: () => provider } as any,
      {
        aiChat: {
          maxContextTokens: params.maxContextTokens ?? 100_000,
          defaultProvider: 'openai',
        },
      } as any,
      { record: jest.fn() } as any,
    );
    await lastValueFrom(
      service
        .streamResponse({
          systemPrompt: 'sys',
          chatHistory: params.chatHistory,
          userMessage: 'now',
          llmConfig: { model: 'gpt-4o-mini' },
        })
        .pipe(toArray()),
    );
    return sent;
  };

  const turns = (n: number, size = 1): LlmMessage[] =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `t${i}`.padEnd(size, '.'),
    }));
  const summary: LlmMessage = {
    role: 'system',
    content: 'Summary of earlier conversation:\nThey discussed rapport.',
  };

  it('keeps a leading summary when the history exceeds the default cap', async () => {
    const sent = await run({ chatHistory: [summary, ...turns(15)] });

    expect(sent[0].content).toBe('sys');
    expect(sent[1]).toEqual(summary);
    // Default cap of 10 verbatim turns still applies to everything else.
    expect(sent.slice(2, -1)).toEqual(turns(15).slice(-10));
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'now' });
  });

  it('drops the oldest verbatim turns before the summary when over the token budget', async () => {
    // 4 turns of 400 chars (~100 tokens each) + a short summary, prompt and
    // user message: a 250-token budget leaves room for two turns.
    const history = [summary, ...turns(4, 400)];

    const sent = await run({ chatHistory: history, maxContextTokens: 250 });

    expect(sent[1]).toEqual(summary);
    expect(sent.slice(2, -1)).toEqual(turns(4, 400).slice(-2));
  });

  it('drops the summary only once no verbatim turn is left', async () => {
    const bigSummary: LlmMessage = { role: 'system', content: 'x'.repeat(800) };

    const sent = await run({
      chatHistory: [bigSummary, ...turns(2, 400)],
      maxContextTokens: 50,
    });

    expect(sent).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'now' },
    ]);
  });
});
