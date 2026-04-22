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

    try {
      const response = await this.client.messages.create({
        model: modelOverride ?? this.model,
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

      return extractContent(
        fieldName,
        stripMarkdownFences(content),
        behaviorIdMapping,
      );
    } catch (error) {
      this.logger.error(
        `Error generating content for prompt code: ${promptCode}`,
        error as any,
      );
      throw error;
    }
  }
}
