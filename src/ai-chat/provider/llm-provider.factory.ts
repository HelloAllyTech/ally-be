import { Injectable } from '@nestjs/common';
import { LlmProvider } from '../interface/llm-provider.interface';
import { OpenAiLlmProvider } from './openai-llm.provider';
import { AppConfigService } from 'src/config/config.service';

@Injectable()
export class LlmProviderFactory {
  private readonly providers: Map<string, LlmProvider>;

  constructor(
    private readonly configService: AppConfigService,
    private readonly openAiProvider: OpenAiLlmProvider,
  ) {
    this.providers = new Map<string, LlmProvider>([
      ['openai', this.openAiProvider],
    ]);
  }

  getProvider(providerType?: string): LlmProvider {
    const type = providerType ?? this.configService.aiChat.defaultProvider;
    const provider = this.providers.get(type);

    if (!provider) {
      throw new Error(`LLM provider "${type}" is not registered`);
    }

    return provider;
  }
}
