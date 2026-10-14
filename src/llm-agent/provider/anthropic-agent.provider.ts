import Anthropic from '@anthropic-ai/sdk';
import {
  claudeModelAcceptsForcedToolChoice,
  modelSupportsTemperature,
} from 'src/common/util/llm-model.util';
import {
  AgentContentBlock,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
  AgentSystemBlock,
} from '../type/agent-llm.type';
import { systemBlocks } from '../util/agent-system.util';
import { IAgentLlmProvider } from './agent-llm-provider.interface';

/**
 * Tool name used to force a JSON object out of a model with no JSON mode.
 *
 * Arbitrary but stable: it appears in the request and in the returned tool_use
 * block, and the adapter looks for it when turning the result back into text.
 */
const JSON_MODE_TOOL = 'emit_json';

/**
 * Appended to the system prompt in JSON mode on a model that rejects a forced
 * `tool_choice`, where the instruction is what steers the model to the tool.
 */
const JSON_MODE_INSTRUCTION =
  `Respond by calling the ${JSON_MODE_TOOL} tool exactly once, with the ` +
  'JSON object as its input. Do not answer in prose.';

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

    // A caller that brought its own tools keeps them; see the spec.
    const jsonTool = Boolean(request.jsonMode) && !request.tools?.length;
    const forceJsonTool =
      jsonTool && claudeModelAcceptsForcedToolChoice(request.model);

    const stream = client.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        // Blocks rather than a string, because `cache_control` attaches per
        // block and the boundary after the last cached one is what the API
        // reuses next turn. A caller passing a plain string gets a single
        // uncached block, which is byte-identical to what it sent before.
        system: [
          ...systemBlocks(request.system),
          // Appended, uncached, after every cached span: the prefix the cache
          // matched last turn is untouched.
          ...(jsonTool && !forceJsonTool
            ? [{ text: JSON_MODE_INSTRUCTION }]
            : []),
        ].map((block: AgentSystemBlock) => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cache
            ? { cache_control: { type: 'ephemeral' as const } }
            : {}),
        })),
        messages: request.messages as any,
        ...(request.tools?.length ? { tools: request.tools as any } : {}),
        // The object comes back as the input of a single tool. Prefilling the
        // assistant turn with `{` — what the autofill path used to do — is a
        // 400 on the 4.6+ family. Structured outputs (`output_config.format`)
        // and strict tools would be the native route, but both need a closed
        // schema (`additionalProperties: false` on every object) and jsonMode
        // promises any object with no schema to close.
        //
        // Where the model accepts it, a forced `tool_choice` makes calling the
        // tool the model's only available move and the API enforces it. The
        // newest models reject a forced choice outright, so there it is `auto`
        // plus an instruction naming the tool — and if the model answers in
        // prose anyway, the prose falls through to the caller's own parse.
        ...(jsonTool
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
              tool_choice: forceJsonTool
                ? { type: 'tool', name: JSON_MODE_TOOL }
                : { type: 'auto', disable_parallel_tool_use: true },
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
        // In JSON mode the object arrives as the tool's input, not as text. Presenting it back AS text keeps the neutral contract — every
        // caller of this adapter reads text blocks — so no orchestrator needs
        // a provider-shaped branch to unwrap it.
        content: request.jsonMode ? jsonBlocksAsText(content) : content,
        stopReason: STOP_REASONS[finalMessage?.stop_reason] ?? 'other',
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cachedTokens: usage?.cache_read_input_tokens ?? undefined,
          cacheCreationTokens: usage?.cache_creation_input_tokens ?? undefined,
        },
      },
    };
  }
}

/**
 * Rewrites the JSON tool's result as a text block carrying its JSON.
 *
 * Falls through untouched when the block is absent — a turn cut off at
 * max_tokens truncates it, and under `auto` the model may answer in prose —
 * and the caller's own parse is a better judge than a silently empty result.
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
