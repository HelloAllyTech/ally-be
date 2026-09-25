import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from 'src/config/config.service';
import {
  LlmProvider,
  LlmMessage,
  LlmProviderConfig,
  LlmStreamChunk,
  LlmTokenUsage,
} from '../interface/llm-provider.interface';

/** OpenAI's usage block → ours. */
const toTokenUsage = (usage: OpenAI.CompletionUsage): LlmTokenUsage => ({
  promptTokens: usage.prompt_tokens ?? 0,
  completionTokens: usage.completion_tokens ?? 0,
  cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? undefined,
});

@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  private client: OpenAI;

  constructor(private readonly configService: AppConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.openai.apiKey,
    });
  }

  async *streamCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
  ): AsyncIterable<LlmStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: config.model,
      messages,
      stream: true,
      // Adds one final chunk with empty `choices` carrying the call's usage.
      stream_options: { include_usage: true },
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 1500,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;
      if (content) {
        yield { content, finishReason: finishReason ?? undefined };
      }
      if (chunk.usage) {
        yield { content: '', usage: toTokenUsage(chunk.usage) };
      }
    }
  }

  async getCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
    onUsage?: (usage: LlmTokenUsage) => void,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 1500,
    });

    if (response.usage) onUsage?.(toTokenUsage(response.usage));
    return response.choices[0]?.message?.content ?? '';
  }
}
