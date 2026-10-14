import { AnthropicAgentProvider } from '../anthropic-agent.provider';
import { GeminiAgentProvider } from '../gemini-agent.provider';
import { OpenAiAgentProvider } from '../openai-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
  AgentTurnResult,
} from '../../type/agent-llm.type';

/**
 * `jsonMode` across the three adapters.
 *
 * Grouped in one spec rather than split per provider because the property under
 * test is that they AGREE: a caller asks for a JSON object and gets text
 * containing one, whichever provider ran. The three mechanisms have nothing in
 * common, which is exactly why a caller must not have to know which it got.
 *
 * The Anthropic case is a bug fix, not a port. That path used to force JSON by
 * prefilling the assistant turn with `{`, and the Claude 4.6+ family rejects a
 * trailing assistant message outright ("This model does not support assistant
 * message prefill"). Since ANTHROPIC_AUTOFILL_MODEL defaulted to
 * claude-sonnet-4-6, every JSON-expecting autofill on an Anthropic model was a
 * 400 — invisible only because OpenAI is the default path.
 *
 * The forced tool that replaced it then hit the same wall one generation on:
 * Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 reject a forced `tool_choice`
 * with a 400, so on those (and on any model not known to accept one) the tool
 * is offered under `auto` with an instruction instead.
 */
const request = (
  over: Partial<AgentStreamRequest> = {},
): AgentStreamRequest => ({
  model: 'test-model',
  system: 'be terse',
  messages: [{ role: 'user', content: 'give me an object' }],
  maxTokens: 256,
  ...over,
});

const drain = async (
  provider: { stream: (r: AgentStreamRequest) => AsyncGenerator<any> },
  r: AgentStreamRequest,
): Promise<AgentTurnResult> => {
  let final: AgentTurnResult | undefined;
  for await (const event of provider.stream(
    r,
  ) as AsyncIterable<AgentStreamEvent>) {
    if (event.type === 'final') final = event.message;
  }
  return final!;
};

describe('jsonMode', () => {
  describe('OpenAI — a real response format', () => {
    const client = (captured: any[]) =>
      ({
        chat: {
          completions: {
            create: async (params: any) => {
              captured.push(params);
              return {
                async *[Symbol.asyncIterator]() {
                  yield {
                    choices: [
                      { delta: { content: '{"a":1}' }, finish_reason: 'stop' },
                    ],
                  };
                },
              };
            },
          },
        },
      }) as any;

    it('asks for a json_object when jsonMode is set', async () => {
      const captured: any[] = [];
      const provider = new OpenAiAgentProvider('key', client(captured));

      await drain(provider, request({ jsonMode: true }));

      expect(captured[0].response_format).toEqual({ type: 'json_object' });
    });

    it('sends no response_format otherwise', async () => {
      const captured: any[] = [];
      const provider = new OpenAiAgentProvider('key', client(captured));

      await drain(provider, request());

      expect(captured[0].response_format).toBeUndefined();
    });
  });

  describe('Anthropic — a single tool, because there is no JSON mode', () => {
    const client = (captured: any[], content: any[]) =>
      ({
        messages: {
          stream: (params: any) => {
            captured.push(params);
            const stream: any = {
              async *[Symbol.asyncIterator]() {
                // No text deltas: in JSON mode the object arrives as tool input.
              },
              finalMessage: async () => ({
                content,
                stop_reason: 'tool_use',
                usage: { input_tokens: 3, output_tokens: 4 },
              }),
            };
            return stream;
          },
        },
      }) as any;

    const emitted = (input: unknown) => [
      { type: 'tool_use', id: 't1', name: 'emit_json', input },
    ];

    const sentFor = async (
      over: Partial<AgentStreamRequest>,
      content: any[] = emitted({ a: 1 }),
    ) => {
      const captured: any[] = [];
      const provider = new AnthropicAgentProvider(
        'key',
        client(captured, content),
      );
      await drain(provider, request({ jsonMode: true, ...over }));
      return captured[0];
    };

    describe('on a model that accepts a forced tool_choice', () => {
      it.each([
        'claude-sonnet-4-6',
        'claude-opus-4-8',
        'claude-haiku-4-5-20251001',
        'claude-3-5-sonnet-20241022',
        'claude-opus-5',
        'claude-sonnet-5',
        'claude-fable-5',
        'claude-haiku-5-5',
      ])('%s: forces the single tool', async (model) => {
        const sent = await sentFor({ model });

        expect(sent.tool_choice).toEqual({ type: 'tool', name: 'emit_json' });
        expect(sent.tools).toHaveLength(1);
        expect(sent.tools[0].name).toBe('emit_json');
      });

      it('sends the system prompt exactly as given, with no added instruction', async () => {
        const sent = await sentFor({ model: 'claude-sonnet-4-6' });

        // The forced path needs no steering, so the request these models saw
        // before the 5.5 fix is unchanged byte for byte.
        expect(sent.system).toEqual([{ type: 'text', text: 'be terse' }]);
      });

      it('never prefills the assistant turn', async () => {
        const sent = await sentFor({ model: 'claude-sonnet-4-6' });

        // The regression that mattered: a trailing assistant turn is a 400 on
        // every current Claude model.
        expect(sent.messages.some((m: any) => m.role === 'assistant')).toBe(
          false,
        );
      });
    });

    describe('on a model that rejects a forced tool_choice', () => {
      it.each([
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-fable-5-1',
        'claude-mythos-5-1',
        // Unrecognised — including whatever ships next — gets the path that
        // works everywhere, not the one that 400s on the newest models.
        'claude-opus-6',
        'test-model',
      ])(
        '%s: offers the tool under auto, at most once, and never forces it',
        async (model) => {
          const sent = await sentFor({ model });

          expect(sent.tool_choice).toEqual({
            type: 'auto',
            disable_parallel_tool_use: true,
          });
          expect(sent.tools).toHaveLength(1);
          expect(sent.tools[0].name).toBe('emit_json');
          // `strict` needs a closed schema, and jsonMode has none to close.
          expect(sent.tools[0].strict).toBeUndefined();
          expect(sent.output_config).toBeUndefined();
          expect(sent.messages.some((m: any) => m.role === 'assistant')).toBe(
            false,
          );
        },
      );

      it('appends an instruction naming the tool after the caller’s system prompt', async () => {
        const sent = await sentFor({ model: 'claude-sonnet-5-5' });

        expect(sent.system).toHaveLength(2);
        expect(sent.system[0]).toEqual({ type: 'text', text: 'be terse' });
        expect(sent.system[1].text).toContain('emit_json');
        expect(sent.system[1].cache_control).toBeUndefined();
      });

      it('leaves cached system spans and their boundaries as they were', async () => {
        const sent = await sentFor({
          model: 'claude-opus-5-5',
          system: [
            { text: 'stable rubric', cache: true },
            { text: 'this turn only' },
          ],
        });

        expect(sent.system.slice(0, 2)).toEqual([
          {
            type: 'text',
            text: 'stable rubric',
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: 'this turn only' },
        ]);
        expect(sent.system).toHaveLength(3);
      });

      it('returns only the object when the model thinks and talks before calling the tool', async () => {
        const captured: any[] = [];
        const provider = new AnthropicAgentProvider(
          'key',
          client(captured, [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'text', text: 'Here is the object.' },
            ...emitted({ ok: true }),
          ]),
        );

        const final = await drain(
          provider,
          request({ model: 'claude-opus-5-5', jsonMode: true }),
        );

        expect(final.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
      });

      it('hands prose back untouched when the model does not call the tool', async () => {
        // `auto` cannot guarantee the call. The caller's own parse sees what
        // the model actually wrote, which the fence- and prose-tolerant
        // parsers on these paths can usually still read.
        const provider = new AnthropicAgentProvider(
          'key',
          client([], [{ type: 'text', text: '{"a":1}' }]),
        );

        const final = await drain(
          provider,
          request({ model: 'claude-sonnet-5-5', jsonMode: true }),
        );

        expect(final.content).toEqual([{ type: 'text', text: '{"a":1}' }]);
      });
    });

    it('hands the object back AS text, so no caller unwraps a tool block', async () => {
      const provider = new AnthropicAgentProvider(
        'key',
        client([], emitted({ name: 'x', count: 2 })),
      );

      const final = await drain(
        provider,
        request({ model: 'claude-sonnet-4-6', jsonMode: true }),
      );

      expect(final.content).toEqual([
        { type: 'text', text: '{"name":"x","count":2}' },
      ]);
      expect(JSON.parse((final.content[0] as any).text)).toEqual({
        name: 'x',
        count: 2,
      });
    });

    it('leaves a truncated turn alone rather than inventing an empty object', async () => {
      // A turn cut off at max_tokens loses the block. The caller's own parse
      // failure says more than a silently empty result would.
      const provider = new AnthropicAgentProvider(
        'key',
        client([], [{ type: 'text', text: 'partial' }]),
      );

      const final = await drain(
        provider,
        request({ model: 'claude-sonnet-4-6', jsonMode: true }),
      );

      expect(final.content).toEqual([{ type: 'text', text: 'partial' }]);
    });

    it.each(['claude-sonnet-4-6', 'claude-sonnet-5-5'])(
      '%s: does not hijack a caller that brought its own tools',
      async (model) => {
        const captured: any[] = [];
        const provider = new AnthropicAgentProvider(
          'key',
          client(captured, [{ type: 'text', text: 'hi' }]),
        );

        await drain(
          provider,
          request({
            model,
            jsonMode: true,
            tools: [
              {
                name: 'real_tool',
                description: 'd',
                input_schema: { type: 'object' },
              },
            ],
          }),
        );

        // An agent loop's tools win: replacing them with the JSON shim would
        // break the loop outright, which is worse than prose it can reparse.
        expect(captured[0].tools).toHaveLength(1);
        expect(captured[0].tools[0].name).toBe('real_tool');
        expect(captured[0].tool_choice).toBeUndefined();
        expect(captured[0].system).toEqual([
          { type: 'text', text: 'be terse' },
        ]);
      },
    );

    it('sends no JSON tool, tool_choice or instruction when jsonMode is off', async () => {
      const sent = await sentFor({
        model: 'claude-sonnet-5-5',
        jsonMode: false,
      });

      expect(sent.tools).toBeUndefined();
      expect(sent.tool_choice).toBeUndefined();
      expect(sent.system).toEqual([{ type: 'text', text: 'be terse' }]);
    });
  });

  describe('Gemini — a response mime type', () => {
    const client = (captured: any[]) =>
      ({
        models: {
          generateContentStream: async (params: any) => {
            captured.push(params);
            return {
              async *[Symbol.asyncIterator]() {
                yield {
                  candidates: [
                    {
                      content: { parts: [{ text: '{"a":1}' }] },
                      finishReason: 'STOP',
                    },
                  ],
                };
              },
            };
          },
        },
      }) as any;

    it('sets the JSON response mime type', async () => {
      const captured: any[] = [];
      const provider = new GeminiAgentProvider('key', client(captured));

      await drain(provider, request({ jsonMode: true }));

      expect(captured[0].config.responseMimeType).toBe('application/json');
    });

    it('sets no mime type otherwise', async () => {
      const captured: any[] = [];
      const provider = new GeminiAgentProvider('key', client(captured));

      await drain(provider, request());

      expect(captured[0].config.responseMimeType).toBeUndefined();
    });
  });
});
