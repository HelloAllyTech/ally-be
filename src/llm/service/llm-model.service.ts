import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  canonicalProvider,
  getLlmModels,
  LlmModelInfo,
  LlmRuntime,
  PROVIDER_RUNTIME_MATRIX,
  runtimesForProvider,
} from '../constants/llm-model-registry.constants';
import { CreateLlmModelDto, UpdateLlmModelDto } from '../dto/llm-model.dto';
import { LlmModels } from '../entity/llm-models.entity';
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

  /**
   * Every catalog row, inactive included, for the admin screen.
   *
   * Unlike `getModels` this does NOT fall back to the in-code list: an editor
   * must see what is actually stored, or it would offer to edit rows that do
   * not exist.
   */
  async getCatalog(): Promise<LlmModels[]> {
    return this.llmModelsRepository.listModels(false);
  }

  async createModel(dto: CreateLlmModelDto): Promise<LlmModels> {
    const provider = this.assertRunnableProvider(dto.provider);
    const model = this.assertModel(dto.model);
    await this.assertNotDuplicate(provider, model);

    return this.llmModelsRepository.save(
      this.llmModelsRepository.create({
        provider,
        model,
        // An empty label would render as a blank picker entry.
        label: dto.label?.trim() || model,
        supportsTemperature: dto.supportsTemperature ?? true,
        active: dto.active ?? true,
      }),
    );
  }

  async updateModel(id: string, dto: UpdateLlmModelDto): Promise<LlmModels> {
    const existing = await this.llmModelsRepository.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Model not found');

    const provider =
      dto.provider === undefined
        ? existing.provider
        : this.assertRunnableProvider(dto.provider);
    const model =
      dto.model === undefined ? existing.model : this.assertModel(dto.model);

    if (provider !== existing.provider || model !== existing.model) {
      await this.assertNotDuplicate(provider, model, id);
    }

    Object.assign(existing, {
      provider,
      model,
      label: dto.label?.trim() || existing.label || model,
      supportsTemperature:
        dto.supportsTemperature ?? existing.supportsTemperature,
      active: dto.active ?? existing.active,
    });

    return this.llmModelsRepository.save(existing);
  }

  /**
   * Remove a catalog row.
   *
   * Nothing references it by id — configs and prompts store the model string
   * — so deleting only takes it out of the pickers and cannot break a running
   * session. Deactivating is still the gentler option and is what the UI
   * suggests.
   */
  async deleteModel(id: string): Promise<{ deleted: true }> {
    const result = await this.llmModelsRepository.delete(id);
    if (!result.affected) throw new NotFoundException('Model not found');
    return { deleted: true };
  }

  /**
   * A provider with no runtime cannot be executed by any deployed code, so
   * offering it would produce a silently wrong client rather than an error.
   * This is the boundary the catalog-in-DB decision rests on.
   */
  private assertRunnableProvider(provider: string): string {
    // Store the canonical name, so the catalog never accumulates two spellings
    // of the same provider.
    const normalised = canonicalProvider(provider);
    if (runtimesForProvider(normalised).length === 0) {
      throw new BadRequestException(
        `No runtime can execute "${provider}". Supported providers: ${Object.keys(
          PROVIDER_RUNTIME_MATRIX,
        ).join(
          ', ',
        )}. Adding a provider is a code change, not a config change.`,
      );
    }
    return normalised;
  }

  private assertModel(model: string): string {
    const trimmed = String(model ?? '').trim();
    if (!trimmed) throw new BadRequestException('Model id is required.');
    return trimmed;
  }

  private async assertNotDuplicate(
    provider: string,
    model: string,
    ignoreId?: string,
  ): Promise<void> {
    const clash = await this.llmModelsRepository.findOne({
      where: { provider, model },
    });
    if (clash && clash.id !== ignoreId) {
      throw new ConflictException(
        `${provider} already has a "${model}" entry in the catalog.`,
      );
    }
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
            // Canonical spelling only: a stored 'google' is served as 'gemini'
            // so the pickers, which group by provider, see one name.
            provider: canonicalProvider(
              row.provider,
            ) as LlmModelInfo['provider'],
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
