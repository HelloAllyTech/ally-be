import { AnthropicAgentProvider } from '../anthropic-agent.provider';
import { GeminiAgentProvider } from '../gemini-agent.provider';
import { OpenAiAgentProvider } from '../openai-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
} from '../../type/agent-llm.type';

/**
 * System spans and cache boundaries, across the three adapters.
 *
 * The property under test is the one Builder's interview depends on and
 * character-interview never needed: a caller can mark a long stable prefix as
 * cacheable, and the adapter that can express that does, while the adapters
 * that cannot still receive every word.
 *
 * This exists because the shared request type used to accept a `string` only.
 * Builder's interview sends its repo packs, curated lessons and worked
 * examples as `cache_control: ephemeral` blocks — its own comment calls the
 * ordering "load-bearing, not cosmetic" — so migrating it onto this layer
 * without spans would have silently dropped prompt caching and made a
 * twenty-turn interview pay full input price twenty times. No error, just a
 * bigger bill.
 */
const drain = async (
  provider: { stream: (r: AgentStreamRequest) => AsyncGenerator<any> },
  r: AgentStreamRequest,
): Promise<void> => {
  // Drained rather than inspected: these tests assert on what the adapter
  // SENT, which it only builds once the stream is consumed.
  const events = provider.stream(r) as AsyncIterable<AgentStreamEvent>;
  for await (const event of events) {
    void event;
  }
};

const base = (over: Partial<AgentStreamRequest> = {}): AgentStreamRequest => ({
  model: 'test-model',
  system: 'be terse',
  messages: [{ role: 'user', content: 'hello' }],
  maxTokens: 128,
  ...over,
});

describe('system spans', () => {
  describe('Anthropic — the adapter that can express a boundary', () => {
    const client = (captured: any[]) =>
      ({
        messages: {
          stream: (params: any) => {
            captured.push(params);
            const stream: any = {
              async *[Symbol.asyncIterator]() {
                // No deltas needed; the final message is what matters.
              },
              finalMessage: async () => ({
                content: [{ type: 'text', text: 'ok' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
            };
            return stream;
          },
        },
      }) as any;

    it('sends a plain string as one uncached block', async () => {
      const captured: any[] = [];
      await drain(new AnthropicAgentProvider('key', client(captured)), base());

      expect(captured[0].system).toEqual([{ type: 'text', text: 'be terse' }]);
    });

    it('marks a cached span with cache_control, and leaves the rest alone', async () => {
      const captured: any[] = [];
      await drain(
        new AnthropicAgentProvider('key', client(captured)),
        base({
          system: [
            { text: 'stable repo knowledge', cache: true },
            { text: 'the volatile draft' },
          ],
        }),
      );

      expect(captured[0].system).toEqual([
        {
          type: 'text',
          text: 'stable repo knowledge',
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'the volatile draft' },
      ]);
    });

    it('keeps the spans in order, because the boundary is positional', async () => {
      // A cached block AFTER the volatile one caches nothing useful: the
      // prefix it names changes every turn. Order is the whole mechanism.
      const captured: any[] = [];
      await drain(
        new AnthropicAgentProvider('key', client(captured)),
        base({
          system: [{ text: 'first', cache: true }, { text: 'second' }],
        }),
      );

      expect(captured[0].system.map((b: any) => b.text)).toEqual([
        'first',
        'second',
      ]);
    });
  });

  describe('the adapters with no per-request cache control', () => {
    it('OpenAI receives every span, joined', async () => {
      const captured: any[] = [];
      const client = {
        chat: {
          completions: {
            create: async (params: any) => {
              captured.push(params);
              return {
                async *[Symbol.asyncIterator]() {
                  yield {
                    choices: [
                      { delta: { content: 'ok' }, finish_reason: 'stop' },
                    ],
                  };
                },
              };
            },
          },
        },
      } as any;

      await drain(
        new OpenAiAgentProvider('key', client),
        base({ system: [{ text: 'alpha', cache: true }, { text: 'beta' }] }),
      );

      expect(captured[0].messages[0]).toEqual({
        role: 'system',
        content: 'alpha\n\nbeta',
      });
    });

    it('Gemini receives every span, joined', async () => {
      const captured: any[] = [];
      const client = {
        models: {
          generateContentStream: async (params: any) => {
            captured.push(params);
            return (async function* () {
              yield { text: 'ok' };
            })();
          },
        },
      } as any;

      await drain(
        new GeminiAgentProvider('key', client),
        base({ system: [{ text: 'alpha', cache: true }, { text: 'beta' }] }),
      );

      expect(captured[0].config.systemInstruction).toBe('alpha\n\nbeta');
    });

    it('drops an empty span rather than leaving a blank gap', async () => {
      const captured: any[] = [];
      const client = {
        chat: {
          completions: {
            create: async (params: any) => {
              captured.push(params);
              return {
                async *[Symbol.asyncIterator]() {
                  yield {
                    choices: [
                      { delta: { content: 'ok' }, finish_reason: 'stop' },
                    ],
                  };
                },
              };
            },
          },
        },
      } as any;

      await drain(
        new OpenAiAgentProvider('key', client),
        base({
          system: [{ text: 'alpha' }, { text: '   ' }, { text: 'beta' }],
        }),
      );

      expect(captured[0].messages[0].content).toBe('alpha\n\nbeta');
    });
  });
});
