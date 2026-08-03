import { Injectable, NotFoundException } from '@nestjs/common';
import { LlmConfigService } from 'src/learn/service/llm-config.service';
import { LlmModelService } from 'src/llm/service/llm-model.service';
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
    private readonly llmModelService: LlmModelService,
    private readonly providerFactory: LlmProviderFactory,
  ) {}

  /**
   * Test a catalog model against its provider.
   *
   * The catalog replaced llm_configs as the thing an admin edits, so this is
   * the preview that matters now. A catalog row has no temperature — that is a
   * per-prompt concern — so the call goes out with the provider's default.
   */
  async previewModel(modelId: string): Promise<LlmPreviewResponse> {
    const row = (await this.llmModelService.getCatalog()).find(
      (model) => model.id === modelId,
    );
    if (!row) {
      throw new NotFoundException('Model not found');
    }

    const provider = this.providerFactory.createProvider(
      row.provider,
      row.model,
    );
    const result = await provider.complete(PREVIEW_PROMPT, PREVIEW_TIMEOUT_MS);

    return {
      ...result,
      configName: row.label,
      provider: row.provider,
      model: row.model,
    };
  }

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
