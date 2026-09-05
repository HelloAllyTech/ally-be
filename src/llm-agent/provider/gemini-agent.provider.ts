import { GoogleGenAI } from '@google/genai';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import {
  AgentContentBlock,
  AgentStopReason,
  AgentStreamEvent,
  AgentStreamRequest,
} from '../type/agent-llm.type';
import { toGeminiParameters } from '../util/gemini-schema.util';
import { IAgentLlmProvider } from './agent-llm-provider.interface';

const STOP_REASONS: Record<string, AgentStopReason> = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  // Gemini attempted a tool call and emitted something it could not parse
  // back. The candidate comes through empty, so without this the turn looks
  // like the model simply had nothing to say.
  MALFORMED_FUNCTION_CALL: 'invalid_tool_call',
};

/** Gemini has no tool-call id, so we mint one and resolve it back by name. */
const syntheticId = (name: string, index: number) => `gemini_${name}_${index}`;

/**
 * Gemini adapter over `@google/genai`.
 *
 * Three differences from the neutral vocabulary, all of them load-bearing:
 *
 * - **No tool-call ids.** A `functionResponse` is matched to its call by tool
 *   *name*. So calls get a synthetic id on the way out, and on the way back in
 *   the id is resolved to a name against the calls earlier in the same request.
 *   That indirection is also what lets a session started on Claude — whose
 *   transcript is full of `toolu_…` ids — resume on Gemini without a rewrite.
 * - **Responses are objects, not strings.** The neutral block carries JSON
 *   text, so it is parsed back; text that isn't JSON is wrapped rather than
 *   dropped.
 * - **Tool use has no distinct finish reason.** A turn with `functionCall`
 *   parts finishes as `STOP`, so tool use is detected from the parts.
 */
export class GeminiAgentProvider implements IAgentLlmProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly clientOverride?: GoogleGenAI,
  ) {}

  async *stream(request: AgentStreamRequest): AsyncGenerator<AgentStreamEvent> {
    const client =
      this.clientOverride ?? new GoogleGenAI({ apiKey: this.apiKey });

    const stream = await client.models.generateContentStream({
      model: request.model,
      contents: this.toGeminiContents(request.messages),
      config: {
        systemInstruction: request.system,
        maxOutputTokens: request.maxTokens,
        ...(request.tools?.length
          ? {
              tools: [
                {
                  functionDeclarations: request.tools.map((tool) => {
                    const parameters = toGeminiParameters(tool.input_schema);
                    return {
                      name: tool.name,
                      description: tool.description,
                      ...(parameters ? { parameters } : {}),
                    };
                  }),
                },
              ],
            }
          : {}),
        ...(request.temperature !== undefined &&
        modelSupportsTemperature(request.model)
          ? { temperature: request.temperature }
          : {}),
      },
    });

    let text = '';
    let finishReason: string | undefined;
    let usage: any;
    const calls: { name: string; input: Record<string, any> }[] = [];

    for await (const chunk of stream as AsyncIterable<any>) {
      if (chunk?.usageMetadata) {
        usage = chunk.usageMetadata;
      }
      const candidate = chunk?.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
      }
      // Read parts directly rather than `chunk.text`, which warns and returns
      // nothing useful once a chunk mixes text with a functionCall.
      for (const part of candidate?.content?.parts ?? []) {
        if (part?.text) {
          text += part.text;
          yield { type: 'text_delta', text: part.text };
        }
        if (part?.functionCall?.name) {
          calls.push({
            name: part.functionCall.name,
            input: (part.functionCall.args ?? {}) as Record<string, any>,
          });
        }
      }
    }

    const content: AgentContentBlock[] = [];
    if (text) {
      content.push({ type: 'text', text });
    }
    calls.forEach((call, index) => {
      content.push({
        type: 'tool_use',
        id: syntheticId(call.name, index),
        name: call.name,
        input: call.input,
      });
    });

    // A truncated turn wins over its tool calls: the arguments Gemini managed
    // to emit before the cap are as unusable as Anthropic's partial ones, and
    // the caller's `max_tokens` path is what knows how to recover.
    let stopReason: AgentStopReason =
      STOP_REASONS[finishReason ?? ''] ?? 'other';
    if (stopReason !== 'max_tokens' && calls.length > 0) {
      stopReason = 'tool_use';
    }

    yield {
      type: 'final',
      message: {
        content,
        stopReason,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
          cachedTokens: usage?.cachedContentTokenCount ?? undefined,
        },
      },
    };
  }

  private toGeminiContents(messages: AgentStreamRequest['messages']): any[] {
    // Tool results name their call by id; Gemini needs the tool's name. Every
    // id we could be asked about was declared by an assistant turn earlier in
    // this same request, whichever provider originally minted it.
    const toolNamesById = new Map<string, string>();
    for (const message of messages) {
      if (typeof message.content === 'string') {
        continue;
      }
      for (const block of message.content) {
        if (block.type === 'tool_use') {
          toolNamesById.set(block.id, block.name);
        }
      }
    }

    const contents: any[] = [];
    const push = (role: 'user' | 'model', parts: any[]) => {
      if (parts.length === 0) {
        return;
      }
      // Gemini expects alternating turns; our tool-result turns can otherwise
      // land next to a following user message.
      const last = contents[contents.length - 1];
      if (last?.role === role) {
        last.parts.push(...parts);
        return;
      }
      contents.push({ role, parts });
    };

    for (const message of messages) {
      const role = message.role === 'assistant' ? 'model' : 'user';

      if (typeof message.content === 'string') {
        push(role, message.content ? [{ text: message.content }] : []);
        continue;
      }

      const parts: any[] = [];
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          parts.push({
            functionCall: { name: block.name, args: block.input ?? {} },
          });
        } else if (block.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: toolNamesById.get(block.tool_use_id) ?? 'tool',
              response: toResponseObject(block.content),
            },
          });
        }
      }
      push(role, parts);
    }

    return contents;
  }
}

/** Gemini requires an object here; keep non-JSON text rather than losing it. */
const toResponseObject = (content: string): Record<string, any> => {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
};
