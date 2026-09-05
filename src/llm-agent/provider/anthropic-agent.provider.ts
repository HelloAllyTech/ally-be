import Anthropic from '@anthropic-ai/sdk';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  AgentContentBlock,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
} from '../type/agent-llm.type';
import { IAgentLlmProvider } from './agent-llm-provider.interface';

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

    const stream = client.messages.stream({
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages as any,
      ...(request.tools?.length ? { tools: request.tools as any } : {}),
      ...(request.temperature !== undefined &&
      modelSupportsTemperature(request.model)
        ? { temperature: request.temperature }
        : {}),
    });

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

    yield {
      type: 'final',
      message: {
        content: (finalMessage?.content ?? []) as AgentContentBlock[],
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
