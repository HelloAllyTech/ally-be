import { GeminiAgentProvider } from '../gemini-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from '../../type/agent-llm.type';

const fakeClient = (chunks: any[], captured: any[] = []) =>
  ({
    models: {
      generateContentStream: async (params: any) => {
        captured.push(params);
        return {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
          },
        };
      },
    },
  }) as any;

const chunk = (parts: any[], finishReason?: string, usageMetadata?: any) => ({
  candidates: [
    { content: { parts }, ...(finishReason ? { finishReason } : {}) },
  ],
  ...(usageMetadata ? { usageMetadata } : {}),
});

const drain = async (
  provider: GeminiAgentProvider,
  request: AgentStreamRequest,
): Promise<{ deltas: string[]; final: AgentTurnResult }> => {
  const deltas: string[] = [];
  let final: AgentTurnResult | undefined;
  for await (const event of provider.stream(
    request,
  ) as AsyncIterable<AgentStreamEvent>) {
    if (event.type === 'text_delta') {
      deltas.push(event.text);
    } else {
      final = event.message;
    }
  }
  return { deltas, final: final! };
};

const request = (
  overrides: Partial<AgentStreamRequest> = {},
): AgentStreamRequest => ({
  model: 'gemini-2.5-pro',
  system: 'SYSTEM',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 100,
  ...overrides,
});

describe('GeminiAgentProvider', () => {
  it('reports tool use even though the turn finishes as STOP', async () => {
    // Gemini has no tool-use finish reason, so the parts are the only signal.
    // Reading finishReason alone would end the turn with the call unrun.
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([
        chunk([{ text: 'Looking those up.' }]),
        chunk([{ functionCall: { name: 'get_voices', args: {} } }], 'STOP', {
          promptTokenCount: 12,
          candidatesTokenCount: 3,
        }),
      ]),
    );

    const { deltas, final } = await drain(provider, request());

    expect(deltas).toEqual(['Looking those up.']);
    expect(final.stopReason).toBe('tool_use');
    expect(final.content).toEqual([
      { type: 'text', text: 'Looking those up.' },
      {
        type: 'tool_use',
        id: 'gemini_get_voices_0',
        name: 'get_voices',
        input: {},
      },
    ]);
    expect(final.usage.inputTokens).toBe(12);
  });

  it('lets a truncated turn outrank its own tool calls', async () => {
    // Arguments cut off at the cap are as unusable as any other provider's;
    // the caller's max_tokens retry is what recovers from it.
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([
        chunk(
          [
            {
              functionCall: {
                name: 'save_character_draft',
                args: { name: 'As' },
              },
            },
          ],
          'MAX_TOKENS',
        ),
      ]),
    );

    const { final } = await drain(provider, request());

    expect(final.stopReason).toBe('max_tokens');
  });

  it('names a tool result by looking its id up in the same request', async () => {
    // Gemini matches a functionResponse to its call by tool NAME. The id in
    // the transcript may have been minted by Anthropic or OpenAI, so it is
    // resolved against the calls already in this request rather than parsed.
    const captured: any[] = [];
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([chunk([{ text: 'ok' }], 'STOP')], captured),
    );

    await drain(
      provider,
      request({
        messages: [
          { role: 'user', content: 'Build her.' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_01ABC',
                name: 'get_voices',
                input: {},
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_01ABC',
                content: '{"ok":true,"voices":[]}',
              },
            ],
          },
        ],
      }),
    );

    expect(captured[0].contents).toEqual([
      { role: 'user', parts: [{ text: 'Build her.' }] },
      {
        role: 'model',
        parts: [{ functionCall: { name: 'get_voices', args: {} } }],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'get_voices',
              response: { ok: true, voices: [] },
            },
          },
        ],
      },
    ]);
    expect(captured[0].config.systemInstruction).toBe('SYSTEM');
  });

  it('wraps a non-JSON tool result rather than dropping it', async () => {
    const captured: any[] = [];
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([chunk([{ text: 'ok' }], 'STOP')], captured),
    );

    await drain(
      provider,
      request({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'unknown',
                content: 'plain text',
              },
            ],
          },
        ],
      }),
    );

    expect(captured[0].contents[0].parts[0].functionResponse).toEqual({
      name: 'tool',
      response: { result: 'plain text' },
    });
  });

  it('merges consecutive same-role turns', async () => {
    // The truncation retry pushes tool results and then a nudge, which would
    // otherwise be two user turns in a row.
    const captured: any[] = [];
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([chunk([{ text: 'ok' }], 'STOP')], captured),
    );

    await drain(
      provider,
      request({
        messages: [
          { role: 'user', content: 'One' },
          { role: 'user', content: 'Two' },
        ],
      }),
    );

    expect(captured[0].contents).toEqual([
      { role: 'user', parts: [{ text: 'One' }, { text: 'Two' }] },
    ]);
  });

  it('sanitises tool schemas and omits parameters for no-argument tools', async () => {
    const captured: any[] = [];
    const provider = new GeminiAgentProvider(
      'key',
      fakeClient([chunk([{ text: 'ok' }], 'STOP')], captured),
    );

    await drain(
      provider,
      request({
        tools: [
          {
            name: 'get_voices',
            description: 'List voices',
            input_schema: { type: 'object', properties: {} },
          },
          {
            name: 'ask_question',
            description: 'Ask one question',
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
            },
          },
        ],
      }),
    );

    expect(captured[0].config.tools).toEqual([
      {
        functionDeclarations: [
          { name: 'get_voices', description: 'List voices' },
          {
            name: 'ask_question',
            description: 'Ask one question',
            parameters: {
              type: 'OBJECT',
              properties: { prompt: { type: 'STRING' } },
              required: ['prompt'],
            },
          },
        ],
      },
    ]);
  });
});
