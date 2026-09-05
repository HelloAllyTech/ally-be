import OpenAI from 'openai';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  AgentContentBlock,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
} from '../type/agent-llm.type';
import { IAgentLlmProvider } from './agent-llm-provider.interface';

const STOP_REASONS: Record<string, AgentStopReason> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
};

/** Accumulator for a tool call arriving in fragments across stream deltas. */
interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * OpenAI adapter over Chat Completions.
 *
 * Two shape differences from the neutral (Anthropic) vocabulary:
 *
 * - Tool results are their own `tool` role rather than blocks inside a user
 *   turn, so one neutral user message carrying N results expands to N messages.
 * - Tool arguments are a JSON *string*, not an object, in both directions.
 *   Arguments that fail to parse are handed back as `{}` rather than throwing:
 *   a truncated turn is exactly when they don't parse, and the caller's
 *   `max_tokens` handling is what should deal with it.
 */
export class OpenAiAgentProvider implements IAgentLlmProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    private readonly clientOverride?: OpenAI,
  ) {}

  async *stream(request: AgentStreamRequest): AsyncGenerator<AgentStreamEvent> {
    const client = this.clientOverride ?? new OpenAI({ apiKey: this.apiKey });

    const stream = await client.chat.completions.create({
      model: request.model,
      messages: this.toOpenAiMessages(request),
      max_completion_tokens: request.maxTokens,
      ...(request.tools?.length
        ? { tools: this.toOpenAiTools(request.tools) }
        : {}),
      ...(request.temperature !== undefined &&
      modelSupportsTemperature(request.model)
        ? { temperature: request.temperature }
        : {}),
      stream: true,
      // Without this the usage block never arrives on a streamed call and
      // every interview turn would record zero tokens.
      stream_options: { include_usage: true },
    });

    let text = '';
    let finishReason: string | undefined;
    let usage: any;
    // Keyed by the delta's `index`, which is the only thing tying a fragment
    // to its call — `id` and `name` arrive once, on the first fragment only.
    const toolCalls = new Map<number, PartialToolCall>();

    for await (const chunk of stream as AsyncIterable<any>) {
      if (chunk?.usage) {
        usage = chunk.usage;
      }
      const choice = chunk?.choices?.[0];
      if (!choice) {
        continue;
      }
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: 'text_delta', text: delta.content };
      }

      for (const fragment of delta?.tool_calls ?? []) {
        const index = fragment.index ?? 0;
        const existing = toolCalls.get(index) ?? {
          id: '',
          name: '',
          args: '',
        };
        if (fragment.id) {
          existing.id = fragment.id;
        }
        if (fragment.function?.name) {
          existing.name = fragment.function.name;
        }
        if (fragment.function?.arguments) {
          existing.args += fragment.function.arguments;
        }
        toolCalls.set(index, existing);
      }
    }

    const content: AgentContentBlock[] = [];
    if (text) {
      content.push({ type: 'text', text });
    }
    for (const call of [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)) {
      content.push({
        type: 'tool_use',
        id: call.id || `call_${call.name}_${content.length}`,
        name: call.name,
        input: parseArguments(call.args),
      });
    }

    yield {
      type: 'final',
      message: {
        content,
        stopReason: STOP_REASONS[finishReason ?? ''] ?? 'other',
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cachedTokens:
            usage?.prompt_tokens_details?.cached_tokens ?? undefined,
        },
      },
    };
  }

  private toOpenAiTools(
    tools: NonNullable<AgentStreamRequest['tools']>,
  ): any[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  private toOpenAiMessages(request: AgentStreamRequest): any[] {
    const messages: any[] = [{ role: 'system', content: request.system }];

    for (const message of request.messages) {
      if (typeof message.content === 'string') {
        messages.push({ role: message.role, content: message.content });
        continue;
      }

      const blocks = message.content;
      const toolResults = blocks.filter(
        (block): block is Extract<AgentContentBlock, { type: 'tool_result' }> =>
          block.type === 'tool_result',
      );
      const text = blocks
        .filter(
          (block): block is Extract<AgentContentBlock, { type: 'text' }> =>
            block.type === 'text',
        )
        .map((block) => block.text)
        .join('\n\n');

      if (message.role === 'user') {
        // A user turn is either prose or a batch of tool results, never both.
        for (const result of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: result.tool_use_id,
            content: result.content,
          });
        }
        if (text) {
          messages.push({ role: 'user', content: text });
        }
        continue;
      }

      const calls = blocks.filter(
        (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use',
      );
      messages.push({
        role: 'assistant',
        // Explicitly null, not '': the API rejects an assistant turn that has
        // neither content nor tool_calls, and '' counts as neither.
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      });
    }

    return messages;
  }
}

const parseArguments = (args: string): Record<string, any> => {
  if (!args?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
