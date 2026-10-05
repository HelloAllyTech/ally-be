import { ScenarioSessionChatService } from '../scenario-session-chat.service';
import { AiChatService } from 'src/ai-chat/service/ai-chat.service';
import {
  LlmMessage,
  LlmStreamChunk,
} from 'src/ai-chat/interface/llm-provider.interface';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { CHAT_MAX_HISTORY_MESSAGES } from '../../constants/scenario-session-chat.constants';

/**
 * What one debrief-chat turn actually sends the model. Runs the real
 * AiChatService (only the provider is faked) because the waste lived in the
 * hand-off: this service built a history the pruning step then cut, and the
 * learner's message rode in both the history and the user turn.
 */
describe('ScenarioSessionChatService.streamChat — what reaches the model', () => {
  const tenantId = 't-1';
  const sessionId = 'sess-1';
  const userId = 7;

  const message = (i: number, senderId: number) => ({
    id: `m-${i}`,
    chatId: 'chat-1',
    senderId,
    content: `message ${i}`,
    tenantId,
  });

  /** `count` prior messages, alternating learner / assistant (-1). */
  const priorMessages = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      message(i, i % 2 === 0 ? userId : -1),
    );

  const setup = (opts: {
    prior: ReturnType<typeof priorMessages>;
    summary?: string | null;
    summarizedMessageCount?: number;
  }) => {
    const chat = {
      id: 'chat-1',
      scenarioSessionId: sessionId,
      tenantId,
      userId,
      summary: opts.summary ?? null,
      summarizedMessageCount: opts.summarizedMessageCount ?? 0,
    };
    const saved = {
      id: 'm-new',
      chatId: chat.id,
      senderId: userId,
      content: 'What should I have said?',
      tenantId,
    };
    const chatRepo = {
      findOne: jest.fn().mockResolvedValue(chat),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const chatMessageRepo = {
      save: jest
        .fn()
        .mockResolvedValueOnce(saved)
        .mockResolvedValue({ id: 'm-reply' }),
      find: jest.fn().mockResolvedValue([...opts.prior, saved]),
    };

    const sent: LlmMessage[][] = [];
    const provider = {
      streamCompletion: (messages: LlmMessage[]) => {
        sent.push(messages);
        return (async function* () {
          yield { content: 'Try naming the feeling.' } as LlmStreamChunk;
        })();
      },
      getCompletion: jest.fn().mockResolvedValue('fresh summary'),
    };
    const config = {
      aiChat: {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 500,
        maxContextTokens: 100_000,
        defaultProvider: 'openai',
      },
    } as any;
    const aiChatService = new AiChatService(
      { getProvider: () => provider } as any,
      config,
      { record: jest.fn().mockResolvedValue(undefined) } as any,
    );
    const streamSpy = jest.spyOn(aiChatService, 'streamResponse');

    const service = new ScenarioSessionChatService(
      chatRepo as any,
      chatMessageRepo as any,
      {
        buildContext: jest.fn().mockResolvedValue({
          systemPrompt: 'You are a clinical supervisor.',
          metadata: { transcriptMessages: [] },
        }),
      } as any,
      aiChatService,
      config,
      { find: jest.fn() } as any,
      { emit: jest.fn() } as any,
    );

    return { service, saved, sent, streamSpy, provider };
  };

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    jest.spyOn(LoggerService, 'getInstance').mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any);
    jest.spyOn(ExecutionManager, 'getTenantId').mockReturnValue(tenantId);
  });

  afterEach(() => jest.restoreAllMocks());

  it("sends the learner's message once, as the user turn", async () => {
    const { service, saved, sent } = setup({ prior: priorMessages(4) });

    await service.streamChat(sessionId, userId, saved.content);
    await flush();

    expect(sent).toHaveLength(1);
    const contents = sent[0].map((m) => m.content);
    expect(contents.filter((c) => c === saved.content)).toHaveLength(1);
    expect(sent[0][sent[0].length - 1]).toEqual({
      role: 'user',
      content: saved.content,
    });
    // The four earlier messages are the history, in order.
    expect(contents.slice(1, -1)).toEqual(
      priorMessages(4).map((m) => m.content),
    );
  });

  it('delivers the running summary and the unsummarised overflow, not just the last 10', async () => {
    // 25 earlier messages, the first 10 already folded into the summary:
    // 5 overflow (10..14) + a 10-message window (15..24).
    const prior = priorMessages(25);
    const { service, saved, sent, streamSpy, provider } = setup({
      prior,
      summary: 'They practised reflective listening.',
      summarizedMessageCount: 10,
    });

    await service.streamChat(sessionId, userId, saved.content);
    await flush();

    // Below the batch threshold: no new summarisation call.
    expect(provider.getCompletion).not.toHaveBeenCalled();
    expect(streamSpy.mock.calls[0][0].maxHistoryMessages).toBe(
      CHAT_MAX_HISTORY_MESSAGES,
    );
    expect(sent[0]).toEqual([
      { role: 'system', content: 'You are a clinical supervisor.' },
      {
        role: 'system',
        content:
          'Summary of earlier conversation:\nThey practised reflective listening.',
      },
      ...prior.slice(10).map((m) => ({
        role: m.senderId === -1 ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: saved.content },
    ]);
  });

  it('delivers the summary it has just generated', async () => {
    // 30 earlier messages, none summarised: 20 overflow crosses the batch
    // threshold, so they are summarised and only the window remains verbatim.
    const prior = priorMessages(30);
    const { service, saved, sent, provider } = setup({ prior });

    await service.streamChat(sessionId, userId, saved.content);
    await flush();

    expect(provider.getCompletion).toHaveBeenCalledTimes(1);
    expect(sent[0][1]).toEqual({
      role: 'system',
      content: 'Summary of earlier conversation:\nfresh summary',
    });
    expect(sent[0].slice(2, -1).map((m) => m.content)).toEqual(
      prior.slice(20).map((m) => m.content),
    );
  });
});
