import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from 'src/config/config.service';
import {
  LlmProvider,
  LlmMessage,
  LlmProviderConfig,
  LlmStreamChunk,
} from '../interface/llm-provider.interface';

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
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 1500,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      const finishReason = chunk.choices[0]?.finish_reason;
      if (content) {
        yield { content, finishReason: finishReason ?? undefined };
      }
    }
  }

  async getCompletion(
    messages: LlmMessage[],
    config: LlmProviderConfig,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: config.model,
      messages,
      temperature: config.temperature ?? 0.7,
      max_tokens: config.maxTokens ?? 1500,
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
