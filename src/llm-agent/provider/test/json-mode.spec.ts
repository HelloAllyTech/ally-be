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

  describe('Anthropic — a forced tool, because there is no JSON mode', () => {
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

    it('forces a single tool and never prefills the assistant turn', async () => {
      const captured: any[] = [];
      const provider = new AnthropicAgentProvider(
        'key',
        client(captured, [
          { type: 'tool_use', id: 't1', name: 'emit_json', input: { a: 1 } },
        ]),
      );

      await drain(provider, request({ jsonMode: true }));

      const sent = captured[0];
      expect(sent.tool_choice).toEqual({ type: 'tool', name: 'emit_json' });
      expect(sent.tools).toHaveLength(1);
      // The regression that mattered: a trailing assistant turn is a 400 on
      // every current Claude model.
      expect(sent.messages.some((m: any) => m.role === 'assistant')).toBe(
        false,
      );
    });

    it('hands the object back AS text, so no caller unwraps a tool block', async () => {
      const provider = new AnthropicAgentProvider(
        'key',
        client(
          [],
          [
            {
              type: 'tool_use',
              id: 't1',
              name: 'emit_json',
              input: { name: 'x', count: 2 },
            },
          ],
        ),
      );

      const final = await drain(provider, request({ jsonMode: true }));

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

      const final = await drain(provider, request({ jsonMode: true }));

      expect(final.content).toEqual([{ type: 'text', text: 'partial' }]);
    });

    it('does not hijack a caller that brought its own tools', async () => {
      const captured: any[] = [];
      const provider = new AnthropicAgentProvider(
        'key',
        client(captured, [{ type: 'text', text: 'hi' }]),
      );

      await drain(
        provider,
        request({
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
