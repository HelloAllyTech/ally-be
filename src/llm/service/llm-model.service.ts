import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  getLlmModels,
  LlmModelInfo,
  LlmRuntime,
  runtimesForProvider,
} from '../constants/llm-model-registry.constants';
import { LlmModelsRepository } from '../repository/llm-models.repository';

/**
 * Serves the model catalog, reading `llm_models` and falling back to the
 * in-code list.
 *
 * The response shape is unchanged from when the list lived in code, so every
 * client keeps working: `runtimes` is joined in from the in-code
 * provider×runtime matrix rather than stored per row.
 */
@Injectable()
export class LlmModelService {
  private readonly logger = LoggerService.getInstance(LlmModelService.name);

  constructor(private readonly llmModelsRepository: LlmModelsRepository) {}

  async getModels(runtime?: LlmRuntime): Promise<LlmModelInfo[]> {
    const models = await this.loadModels();
    return runtime
      ? models.filter((model) => model.runtimes.includes(runtime))
      : models;
  }

  private async loadModels(): Promise<LlmModelInfo[]> {
    try {
      const rows = await this.llmModelsRepository.listModels(true);

      // An empty table is treated as "not migrated / not seeded yet", not as
      // "the platform offers no models" — the latter would blank every picker
      // in the product.
      if (rows.length === 0) {
        this.logger.warn(
          '[LLM_MODELS] catalog table is empty — serving the in-code list',
        );
        return getLlmModels();
      }

      return (
        rows
          .map((row) => ({
            provider: row.provider as LlmModelInfo['provider'],
            model: row.model,
            label: row.label,
            supportsTemperature: row.supportsTemperature,
            runtimes: runtimesForProvider(row.provider),
          }))
          // A row whose provider no runtime can execute is unusable — most likely
          // someone added a provider in the DB that has no code branch. Drop it
          // rather than offer a model that silently builds the wrong client.
          .filter((model) => {
            if (model.runtimes.length > 0) return true;
            this.logger.warn(
              `[LLM_MODELS] dropping ${model.provider}/${model.model} — no runtime can execute this provider`,
            );
            return false;
          })
      );
    } catch (error) {
      // The catalog is on the read path of the studio pickers. A DB blip should
      // degrade to the shipped list, not break the page.
      this.logger.error(
        `[LLM_MODELS] catalog read failed, serving the in-code list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return getLlmModels();
    }
  }
}
