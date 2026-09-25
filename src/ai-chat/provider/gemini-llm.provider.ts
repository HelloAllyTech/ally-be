import { Injectable } from '@nestjs/common';
import {
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
} from '@google/genai';
import { AppConfigService } from 'src/config/config.service';
import {
  LlmProvider,
  LlmMessage,
  LlmProviderConfig,
  LlmStreamChunk,
  LlmTokenUsage,
} from '../interface/llm-provider.interface';

/**
 * Gemini's usage block → ours. Thinking tokens bill at the output rate, so they
 * are folded into completion tokens rather than dropped.
 */
const toTokenUsage = (
  usage: GenerateContentResponseUsageMetadata,
): LlmTokenUsage => ({
  promptTokens: usage.promptTokenCount ?? 0,
  completionTokens:
    (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
  cachedTokens: usage.cachedContentTokenCount ?? undefined,
});

/**
 * Gemini coaching-chat provider. Mirrors {@link OpenAiLlmProvider} against the
 * `@google/genai` SDK so a prompt that selects a `gemini-*` model runs for real
 * instead of silently falling back to OpenAI.
 *
 * Message mapping: Gemini keeps the system prompt out of the turn list
 * (`config.systemInstruction`) and uses role `model` for assistant turns, so we
 * fold all `system` messages into the instruction and remap `assistant`→`model`.
 */
@Injectable()
export class GeminiLlmProvider implements LlmProvider {
  private client?: GoogleGenAI;

  constructor(private readonly configService: AppConfigService) {}

  /** Lazily build the client so the app boots even without a key configured;
   * a Gemini-selected chat then fails clearly instead of at module load. */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.configService.gemini.apiKey;
      if (!apiKey) {
        throw new Error(
          'GEMINI_API_KEY is not configured — cannot run a Gemini chat.',
        );
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  /** Split our flat message list into Gemini's (systemInstruction, contents). */
  private toGeminiInput(messages: LlmMessage[]): {
    systemInstruction?: string;
    contents: { role: 'user' | 'model'; parts: { text: string }[] }[];
  } {
    const systemParts: string[] = [];
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] =
      [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemParts.push(message.content);
        continue;
      }
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      });
    }

    return {
      systemInstruction: systemParts.length
        ? systemParts.join('\n\n')
        : undefined,
      contents,
    };
  }

  async *streamCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
  ): AsyncIterable<LlmStreamChunk> {
    const { systemInstruction, contents } = this.toGeminiInput(messages);

    const stream = await this.getClient().models.generateContentStream({
      model: config.model,
      contents,
      config: {
        systemInstruction,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 1500,
      },
    });

    // Gemini repeats a CUMULATIVE usage block on the stream's chunks, so only
    // the last one is reported — yielding each would count the prompt N times.
    let usage: GenerateContentResponseUsageMetadata | undefined;
    for await (const chunk of stream) {
      const content = chunk.text;
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (content) {
        yield { content };
      }
    }
    if (usage) yield { content: '', usage: toTokenUsage(usage) };
  }

  async getCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
    onUsage?: (usage: LlmTokenUsage) => void,
  ): Promise<string> {
    const { systemInstruction, contents } = this.toGeminiInput(messages);

    const response = await this.getClient().models.generateContent({
      model: config.model,
      contents,
      config: {
        systemInstruction,
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxTokens ?? 1500,
      },
    });

    if (response.usageMetadata) onUsage?.(toTokenUsage(response.usageMetadata));
    return response.text ?? '';
  }
}
