import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import { LlmMessage } from 'src/ai-chat/interface/llm-provider.interface';

/** Provider/model actually used for a translation call, after applying defaults. */
export interface ResolvedTranslationEngine {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** The subset of a prompt row that selects the engine (e.g. the translation prompt). */
export interface TranslationEngineSource {
  provider?: string | null;
  model?: string | null;
  temperature?: number | null;
}

/**
 * Resolves which engine translates a prompt template and runs the call through
 * the shared {@link LlmProviderFactory} (same abstraction the coaching chat
 * uses, with `openai` and `gemini` already registered).
 *
 * Precedence for provider/model/temperature: the translation prompt row's own
 * values (editable from Prompt Management) → config defaults
 * (`gemini` / `gemini-2.5-pro`). This is the net-new seam that lets a prompt
 * template be translated by Gemini rather than the hardcoded-OpenAI legacy
 * translation service.
 */
@Injectable()
export class PromptTranslationProviderService {
  private readonly logger = new Logger(PromptTranslationProviderService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly llmProviderFactory: LlmProviderFactory,
  ) {}

  resolveEngine(source?: TranslationEngineSource): ResolvedTranslationEngine {
    const defaults = this.configService.promptTranslation;
    return {
      provider: source?.provider || defaults.defaultProvider,
      model: source?.model || defaults.defaultModel,
      temperature: source?.temperature ?? defaults.temperature,
      maxTokens: defaults.maxTokens,
    };
  }

  /**
   * Translate one prompt body. `systemPrompt` is the agent-template translation
   * instruction (preserve `{…}` / `[…]` tokens, don't execute, apply tone); the
   * user turn is the English body to translate. Returns the raw model output —
   * the placeholder guard (BE-5) validates it upstream.
   */
  async translate(
    systemPrompt: string,
    sourceText: string,
    engine: ResolvedTranslationEngine,
  ): Promise<string> {
    const provider = this.llmProviderFactory.getProvider(engine.provider);
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: sourceText },
    ];

    this.logger.debug(
      `Translating via ${engine.provider}/${engine.model} (temp=${engine.temperature})`,
    );

    return provider.getCompletion(messages, {
      model: engine.model,
      temperature: engine.temperature,
      maxTokens: engine.maxTokens,
    });
  }
}
