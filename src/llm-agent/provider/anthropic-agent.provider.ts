import Anthropic from '@anthropic-ai/sdk';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  AgentContentBlock,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
} from '../type/agent-llm.type';
import { IAgentLlmProvider } from './agent-llm-provider.interface';

/**
 * Tool name used to force a JSON object out of a model with no JSON mode.
 *
 * Arbitrary but stable: it appears in the request and in the returned tool_use
 * block, and the adapter looks for it when turning the result back into text.
 */
const JSON_MODE_TOOL = 'emit_json';

const STOP_REASONS: Record<string, AgentStopReason> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  stop_sequence: 'end_turn',
};

/**
 * Anthropic adapter — the identity mapping, since the neutral block vocabulary
 * is Anthropic's. It exists so the orchestrator has no provider-shaped branch
 * at all, not because there is translation to do.
 */
export class AnthropicAgentProvider implements IAgentLlmProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    /** Injected only by tests, which drive a fake `messages.stream`. */
    private readonly clientOverride?: Anthropic,
  ) {}

  async *stream(request: AgentStreamRequest): AsyncGenerator<AgentStreamEvent> {
    const client =
      this.clientOverride ?? new Anthropic({ apiKey: this.apiKey });

    const stream = client.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages as any,
        ...(request.tools?.length ? { tools: request.tools as any } : {}),
        // No JSON mode on this API. The alternative the autofill path used was
        // prefilling the assistant turn with `{`, which the 4.6+ family
        // rejects with a 400 ("does not support assistant message prefill") —
        // so JSON-expecting autofill was broken on every current Claude model.
        // A single forced tool makes emitting a conforming object the model's
        // only available move, and the API enforces it.
        ...(request.jsonMode && !request.tools?.length
          ? {
              tools: [
                {
                  name: JSON_MODE_TOOL,
                  description:
                    'Return the result as a JSON object. This is the only way ' +
                    'to respond.',
                  input_schema: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              ],
              tool_choice: { type: 'tool', name: JSON_MODE_TOOL },
            }
          : {}),
        ...(request.temperature !== undefined &&
        modelSupportsTemperature(request.model)
          ? { temperature: request.temperature }
          : {}),
      },
      ...(request.timeoutMs !== undefined
        ? [{ timeout: request.timeoutMs }]
        : []),
    );

    for await (const event of stream as AsyncIterable<any>) {
      if (
        event?.type === 'content_block_delta' &&
        event?.delta?.type === 'text_delta' &&
        event.delta.text
      ) {
        yield { type: 'text_delta', text: event.delta.text };
      }
    }

    const finalMessage: any = await (stream as any).finalMessage();
    const usage = finalMessage?.usage;

    const content = (finalMessage?.content ?? []) as AgentContentBlock[];

    yield {
      type: 'final',
      message: {
        // In JSON mode the object arrives as the forced tool's input, not as
        // text. Presenting it back AS text keeps the neutral contract — every
        // caller of this adapter reads text blocks — so no orchestrator needs
        // a provider-shaped branch to unwrap it.
        content: request.jsonMode ? jsonBlocksAsText(content) : content,
        stopReason: STOP_REASONS[finalMessage?.stop_reason] ?? 'other',
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cachedTokens: usage?.cache_read_input_tokens ?? undefined,
        },
      },
    };
  }
}

/**
 * Rewrites the forced-tool result as a text block carrying its JSON.
 *
 * Falls through untouched when the block is absent — a turn cut off at
 * max_tokens truncates it, and the caller's own parse failure is a better
 * error than a silently empty result here.
 */
const jsonBlocksAsText = (
  content: AgentContentBlock[],
): AgentContentBlock[] => {
  const emitted = content.find(
    (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === JSON_MODE_TOOL,
  );
  if (!emitted) {
    return content;
  }
  return [{ type: 'text', text: JSON.stringify(emitted.input ?? {}) }];
};
