import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { canonicalProvider } from 'src/llm/constants/llm-model-registry.constants';
import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { GeminiLlmProvider } from './gemini-llm.provider';
import { ILlmProvider } from './llm-provider.interface';
import { OpenAiLlmProvider } from './openai-llm.provider';

/**
 * Providers this preview can call.
 *
 * `LLM_CONFIG_SCHEMA` accepts `openai | google | gemini | ollama | vllm` while
 * the model catalog uses `openai | gemini | anthropic`. The two spellings of
 * Gemini are reconciled by the shared `canonicalProvider` helper rather than
 * locally here — see the alias note in llm-model-registry.constants.ts.
 */
export enum PreviewableLlmProvider {
  OPENAI = 'openai',
  GEMINI = 'gemini',
  ANTHROPIC = 'anthropic',
}

/** Providers that exist in config but cannot be previewed from ally-be. */
const LOCAL_ONLY_PROVIDERS = new Set(['ollama', 'vllm']);

export const normaliseProvider = (
  provider: string | undefined,
): PreviewableLlmProvider | undefined => {
  const name = canonicalProvider(provider);
  return (Object.values(PreviewableLlmProvider) as string[]).includes(name)
    ? (name as PreviewableLlmProvider)
    : undefined;
};

@Injectable()
export class LlmProviderFactory {
  private readonly logger = new Logger(LlmProviderFactory.name);

  constructor(private readonly configService: AppConfigService) {}

  createProvider(
    provider: string | undefined,
    model: string,
    temperature?: number,
  ): ILlmProvider {
    const rawName = String(provider ?? '')
      .trim()
      .toLowerCase();

    if (LOCAL_ONLY_PROVIDERS.has(rawName)) {
      throw new BadRequestException(
        `${rawName} runs inside the voice runtime, not this service, so it cannot be previewed from here.`,
      );
    }

    const normalised = normaliseProvider(provider);
    if (!normalised) {
      throw new BadRequestException(
        `Unsupported LLM provider "${provider}". Previewable providers: ${Object.values(
          PreviewableLlmProvider,
        ).join(', ')}.`,
      );
    }

    if (!model?.trim()) {
      throw new BadRequestException(
        'This config has no model set, so there is nothing to test.',
      );
    }

    const apiKey = this.apiKeyFor(normalised);
    if (!apiKey) {
      this.logger.warn(
        `Provider ${normalised} is not configured — missing key`,
      );
      throw new BadRequestException(
        `Provider ${normalised} is not configured on this environment. Please contact your administrator.`,
      );
    }

    switch (normalised) {
      case PreviewableLlmProvider.OPENAI:
        return new OpenAiLlmProvider(apiKey, model, temperature);
      case PreviewableLlmProvider.GEMINI:
        return new GeminiLlmProvider(apiKey, model, temperature);
      case PreviewableLlmProvider.ANTHROPIC:
        return new AnthropicLlmProvider(apiKey, model, temperature);
      default: {
        const exhaustive: never = normalised;
        throw new BadRequestException(
          `Unsupported LLM provider: ${exhaustive}`,
        );
      }
    }
  }

  private apiKeyFor(provider: PreviewableLlmProvider): string | undefined {
    switch (provider) {
      case PreviewableLlmProvider.OPENAI:
        return this.configService.openai.apiKey;
      case PreviewableLlmProvider.GEMINI:
        return this.configService.gemini.apiKey;
      case PreviewableLlmProvider.ANTHROPIC:
        return this.configService.anthropic.apiKey;
      default:
        return undefined;
    }
  }
}
