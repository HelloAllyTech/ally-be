import { OpenAiAgentProvider } from '../openai-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from '../../type/agent-llm.type';

/** Fake `chat.completions.create`, capturing the request it was handed. */
const fakeClient = (chunks: any[], captured: any[] = []) =>
  ({
    chat: {
      completions: {
        create: async (params: any) => {
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
    },
  }) as any;

const drain = async (
  provider: OpenAiAgentProvider,
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
  model: 'gpt-5',
  system: 'SYSTEM',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 100,
  ...overrides,
});

describe('OpenAiAgentProvider', () => {
  it('assembles a tool call that arrives in argument fragments', async () => {
    // OpenAI streams a tool call's `arguments` as a JSON string in pieces, with
    // `id` and `name` only on the first fragment; `index` is the only thing
    // tying the rest of them to it.
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: {
                      name: 'save_character_draft',
                      arguments: '{"na',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'me":"Asha"}' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 11, completion_tokens: 4 } },
      ]),
    );

    const { final } = await drain(provider, request());

    expect(final.stopReason).toBe('tool_use');
    expect(final.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'save_character_draft',
        input: { name: 'Asha' },
      },
    ]);
    expect(final.usage).toEqual({
      inputTokens: 11,
      outputTokens: 4,
      cachedTokens: undefined,
    });
  });

  it('maps a truncated turn onto max_tokens', async () => {
    // `length` is what tells the caller not to persist the fragment.
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient([
        { choices: [{ delta: { content: 'Writing' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] },
      ]),
    );

    const { deltas, final } = await drain(provider, request());

    expect(deltas).toEqual(['Writing']);
    expect(final.stopReason).toBe('max_tokens');
    expect(final.content).toEqual([{ type: 'text', text: 'Writing' }]);
  });

  it('keeps unparseable arguments from failing the turn', async () => {
    // Arguments stop parsing exactly when the turn was cut off — the caller's
    // max_tokens handling is what recovers, not an exception from here.
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: {
                      name: 'save_character_draft',
                      arguments: '{"name":"As',
                    },
                  },
                ],
              },
              finish_reason: 'length',
            },
          ],
        },
      ]),
    );

    const { final } = await drain(provider, request());

    expect(final.stopReason).toBe('max_tokens');
    expect((final.content[0] as any).input).toEqual({});
  });

  it('expands tool results into their own tool-role messages', async () => {
    const captured: any[] = [];
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient(
        [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
        captured,
      ),
    );

    await drain(
      provider,
      request({
        messages: [
          { role: 'user', content: 'Build her.' },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'One moment.' },
              {
                type: 'tool_use',
                // An Anthropic-minted id: a session that started on Claude and
                // continued here replays its transcript unchanged.
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
                content: '{"ok":true}',
              },
            ],
          },
        ],
      }),
    );

    expect(captured[0].messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'Build her.' },
      {
        role: 'assistant',
        content: 'One moment.',
        tool_calls: [
          {
            id: 'toolu_01ABC',
            type: 'function',
            function: { name: 'get_voices', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_01ABC', content: '{"ok":true}' },
    ]);
  });

  it('sends a tool-only assistant turn with null content', async () => {
    // '' counts as neither content nor tool_calls and the API rejects it.
    const captured: any[] = [];
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient(
        [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
        captured,
      ),
    );

    await drain(
      provider,
      request({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'call_1', name: 'get_voices', input: {} },
            ],
          },
        ],
      }),
    );

    expect(captured[0].messages[1].content).toBeNull();
  });

  it('drops temperature for models that reject it, and asks for usage', async () => {
    const captured: any[] = [];
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient(
        [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
        captured,
      ),
    );

    await drain(provider, request({ model: 'gpt-5', temperature: 0.4 }));
    expect(captured[0].temperature).toBeUndefined();
    expect(captured[0].max_completion_tokens).toBe(100);
    // Without include_usage a streamed call reports nothing and every turn
    // would be accounted at zero tokens.
    expect(captured[0].stream_options).toEqual({ include_usage: true });

    await drain(provider, request({ model: 'gpt-4o', temperature: 0.4 }));
    expect(captured[1].temperature).toBe(0.4);
  });

  it('converts tool definitions to the function schema', async () => {
    const captured: any[] = [];
    const provider = new OpenAiAgentProvider(
      'key',
      fakeClient(
        [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
        captured,
      ),
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
        ],
      }),
    );

    expect(captured[0].tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_voices',
          description: 'List voices',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });
});
