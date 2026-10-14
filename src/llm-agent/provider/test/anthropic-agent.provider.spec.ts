import { AnthropicAgentProvider } from '../anthropic-agent.provider';
import {
  AgentStreamEvent,
  AgentStreamRequest,
} from '../../type/agent-llm.type';

/**
 * Captures what the adapter sends, so a test can read the request body the
 * Anthropic API would have received.
 */
const fakeClient = (captured: any[]) =>
  ({
    messages: {
      stream: (params: any) => {
        captured.push(params);
        const stream: any = {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: 'ok' },
            };
          },
          finalMessage: async () => ({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 3, output_tokens: 1 },
          }),
        };
        return stream;
      },
    },
  }) as any;

const sentFor = async (over: Partial<AgentStreamRequest>) => {
  const captured: any[] = [];
  const provider = new AnthropicAgentProvider('key', fakeClient(captured));
  const events: AgentStreamEvent[] = [];
  for await (const event of provider.stream({
    model: 'claude-sonnet-4-6',
    system: 'be terse',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 64,
    ...over,
  }) as AsyncIterable<AgentStreamEvent>) {
    events.push(event);
  }
  expect(events[events.length - 1]?.type).toBe('final');
  return captured[0];
};

describe('AnthropicAgentProvider', () => {
  describe('temperature', () => {
    // Opus 4.7 onwards reject `temperature` with a 400, and Sonnet 5.5 rejects
    // any value but the default. feedback-skill-mapper and the skill-experiment
    // judge both send `temperature: 0`, so on these models the call failed
    // outright until the adapter learned to leave it out.
    it.each(['claude-sonnet-5-5', 'claude-opus-4-7'])(
      '%s: leaves temperature out of the request',
      async (model) => {
        const sent = await sentFor({ model, temperature: 0 });

        expect(sent).not.toHaveProperty('temperature');
      },
    );

    it('claude-sonnet-4-6: sends the temperature the caller set, including 0', async () => {
      const sent = await sentFor({
        model: 'claude-sonnet-4-6',
        temperature: 0,
      });

      expect(sent.temperature).toBe(0);
    });

    it('sends none when the caller set none', async () => {
      const sent = await sentFor({ model: 'claude-sonnet-4-6' });

      expect(sent).not.toHaveProperty('temperature');
    });
  });
});
