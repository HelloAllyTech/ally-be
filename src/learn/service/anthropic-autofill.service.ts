import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ScenarioFieldContextDto } from '../dto/generate-scenario-field.dto';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import {
  BehaviorIdMapping,
  GeneratedContent,
} from '../type/generatable-fields.type';
import { PREFERRED_ANTHROPIC_AUTOFILL_MODELS } from '../constants/autofill-models.constants';
import {
  AGENT_BUILDER_MAX_TOKENS,
  AGENT_BUILDER_PROMPT_CODE,
} from '../constants/agent-builder.constants';
import {
  AUTOFILL_CACHE_TTL_MS,
  buildBehaviorIdMapping,
  buildJsonSchemaSuffix,
  buildTemplateVariables,
  extractContent,
  renderTemplate,
  stripMarkdownFences,
} from '../util/autofill-shared.util';
import { AutofillModelInfo } from './openai-autofil-service';

const ANTHROPIC_MAX_TOKENS = 4096;

@Injectable()
export class AnthropicAutofillService {
  private readonly logger = LoggerService.getInstance(
    AnthropicAutofillService.name,
  );

  private readonly client: Anthropic;
  private readonly model: string;

  private modelsCache: { models: AutofillModelInfo[] } | null = null;
  private modelsCacheExpiry = 0;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  buildBehaviorIdMapping(
    behaviors: BehaviorResponseDto[],
  ): ReturnType<typeof buildBehaviorIdMapping> {
    return buildBehaviorIdMapping(behaviors);
  }

  async getAvailableModels(): Promise<AutofillModelInfo[]> {
    const now = Date.now();
    if (this.modelsCache && now < this.modelsCacheExpiry) {
      return this.modelsCache.models;
    }

    try {
      const apiModelIds = new Set<string>();
      for await (const model of this.client.models.list()) {
        apiModelIds.add(model.id);
      }

      const apiModelIdList = [...apiModelIds].sort((a, b) =>
        b.localeCompare(a),
      );
      const result: AutofillModelInfo[] =
        PREFERRED_ANTHROPIC_AUTOFILL_MODELS.map((prefix) =>
          apiModelIdList.find((id) => id.startsWith(prefix)),
        )
          .filter((id): id is string => id !== undefined)
          .map((id) => ({ value: id, label: id, provider: 'anthropic' }));

      this.modelsCache = { models: result };
      this.modelsCacheExpiry = now + AUTOFILL_CACHE_TTL_MS;
      return result;
    } catch (error) {
      this.logger.error(
        'Failed to fetch available Anthropic models, falling back to preferred list',
        error as any,
      );
      return PREFERRED_ANTHROPIC_AUTOFILL_MODELS.map((id) => ({
        value: id,
        label: id,
        provider: 'anthropic',
      }));
    }
  }

  async generateFieldContent(
    fieldName: GeneratableField,
    promptCode: string,
    scenarioContext: ScenarioFieldContextDto,
    behaviorIdMapping?: BehaviorIdMapping,
    modelOverride?: string,
  ): Promise<GeneratedContent> {
    const promptTemplate =
      await this.promptSharedService.getPromptByCode(promptCode);

    if (!promptTemplate) {
      throw new NotFoundException(
        `Prompt template not found for code: ${promptCode}`,
      );
    }

    const templateVariables = buildTemplateVariables(scenarioContext);
    const renderedPrompt = renderTemplate(promptTemplate, templateVariables);
    const jsonSuffix = buildJsonSchemaSuffix(fieldName);
    const fullPrompt = renderedPrompt + jsonSuffix;

    const effectiveModel = modelOverride ?? this.model;
    this.logger.info(
      `[AUTOFILL] start field=${fieldName} promptCode=${promptCode} provider=anthropic model=${effectiveModel} ` +
        `requestedCount=${(scenarioContext as any)?.numStates ?? (scenarioContext as any)?.numKnowledgeSources ?? 'n/a'} ` +
        `existingFilled=${(scenarioContext as any)?.existingStates || (scenarioContext as any)?.existingKnowledgeSources ? 'yes' : 'no'}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.create({
        model: effectiveModel,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: fullPrompt }],
      });

      const block = response.content[0];
      const content = block?.type === 'text' ? block.text.trim() : '';

      if (!content) {
        throw new InternalServerErrorException(
          `Empty response from Anthropic for prompt code: ${promptCode}`,
        );
      }

      const extracted = extractContent(
        fieldName,
        stripMarkdownFences(content),
        behaviorIdMapping,
      );
      const itemCount = Array.isArray(extracted)
        ? extracted.length
        : typeof extracted === 'string'
          ? 1
          : extracted && typeof extracted === 'object'
            ? Object.keys(extracted).length
            : 0;
      this.logger.info(
        `[AUTOFILL] done  field=${fieldName} promptCode=${promptCode} model=${effectiveModel} ` +
          `itemsReturned=${itemCount} elapsedMs=${Date.now() - startedAt}`,
      );
      return extracted;
    } catch (error) {
      this.logger.error(
        `[AUTOFILL] failed field=${fieldName} promptCode=${promptCode} model=${effectiveModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }

  /**
   * Generate a comprehensive roleplay-actor system prompt from a free-text
   * description. Unlike generateFieldContent this returns plain prose (no JSON
   * schema / extraction) using the agent-builder meta prompt as the system
   * message and the author's description as the user message.
   */
  async generateAgentSystemPrompt(
    description: string,
    modelOverride?: string,
  ): Promise<string> {
    const metaPrompt = await this.promptSharedService.getPromptByCode(
      AGENT_BUILDER_PROMPT_CODE,
    );

    if (!metaPrompt) {
      throw new NotFoundException(
        `Prompt template not found for code: ${AGENT_BUILDER_PROMPT_CODE}`,
      );
    }

    const effectiveModel = modelOverride ?? this.model;
    this.logger.info(
      `[AGENT_BUILDER] start provider=anthropic model=${effectiveModel} descriptionLength=${description.length}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.create({
        model: effectiveModel,
        max_tokens: AGENT_BUILDER_MAX_TOKENS,
        system: metaPrompt,
        messages: [{ role: 'user', content: description }],
      });

      const block = response.content[0];
      const content = block?.type === 'text' ? block.text : '';

      if (!content.trim()) {
        throw new InternalServerErrorException(
          'Empty response from Anthropic for agent-builder generation',
        );
      }

      this.logger.info(
        `[AGENT_BUILDER] done provider=anthropic model=${effectiveModel} elapsedMs=${Date.now() - startedAt}`,
      );
      return stripMarkdownFences(content).trim();
    } catch (error) {
      this.logger.error(
        `[AGENT_BUILDER] failed provider=anthropic model=${effectiveModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }
}
