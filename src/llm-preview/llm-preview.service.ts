import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmConfigService } from 'src/learn/service/llm-config.service';
import { LlmProviderFactory } from './providers/llm-provider.factory';
import { LlmPreviewResult } from './providers/llm-provider.interface';

/**
 * Smallest prompt that still proves the round trip: the model has to read an
 * instruction and produce a token. Deliberately fixed rather than caller-supplied
 * so every preview costs the same and results are comparable across models.
 */
export const PREVIEW_PROMPT = 'Reply with the single word: ok';

/** Providers get this long before we give up. Long enough for a cold start on a
 *  large model, short enough that the admin UI is not left hanging. */
export const PREVIEW_TIMEOUT_MS = 20_000;

export interface LlmPreviewResponse extends LlmPreviewResult {
  configName: string;
  provider: string;
  model: string;
}

@Injectable()
export class LlmPreviewService {
  constructor(
    private readonly llmConfigService: LlmConfigService,
    private readonly providerFactory: LlmProviderFactory,
  ) {}

  async previewConfig(configId: string): Promise<LlmPreviewResponse> {
    const config = await this.llmConfigService.getConfigById(configId);
    if (!config) {
      throw new NotFoundException('LLM config not found');
    }

    const model = String(config.config?.model ?? '');
    const temperature =
      typeof config.config?.temperature === 'number'
        ? config.config.temperature
        : undefined;

    // Misconfiguration (unknown/local provider, no model, missing key) throws —
    // that is our problem, not the model's. A provider *rejecting* the call is
    // reported as data, since that is exactly what the button exists to reveal.
    const provider = this.providerFactory.createProvider(
      config.provider,
      model,
      temperature,
    );

    const result = await provider.complete(PREVIEW_PROMPT, PREVIEW_TIMEOUT_MS);

    return {
      ...result,
      configName: config.name,
      provider: config.provider,
      model,
    };
  }
}
