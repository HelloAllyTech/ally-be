import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ScenarioFieldContextDto } from '../dto/generate-scenario-field.dto';
import { GeneratableField } from '../enum/generatable-field.enum';
import { BehaviorResponseDto } from '../dto/behavior-response.dto';
import { STRUCTURED_OUTPUT_SCHEMAS } from '../constants/autofill-structured-output.constants';
import {
  BehaviorIdMapping,
  GeneratedContent,
} from '../type/generatable-fields.type';
import { PREFERRED_AUTOFILL_MODELS } from '../constants/autofill-models.constants';
import {
  AUTOFILL_CACHE_TTL_MS,
  buildBehaviorIdMapping,
  buildTemplateVariables,
  extractContent,
  renderTemplate,
  stripMarkdownFences,
} from '../util/autofill-shared.util';
import { EnhanceableField } from '../enum/enhanceable-field.enum';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from '../enum/llm-task.enum';

export interface AutofillModelInfo {
  value: string;
  label: string;
  provider: string;
}

@Injectable()
export class OpenAIAutofillService {
  private readonly logger = LoggerService.getInstance(
    OpenAIAutofillService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  private modelsCache: { models: AutofillModelInfo[] } | null = null;
  private modelsCacheExpiry = 0;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.autofillModel;
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

      const result: AutofillModelInfo[] = [];
      for (const modelId of PREFERRED_AUTOFILL_MODELS) {
        if (apiModelIds.has(modelId)) {
          result.push({ value: modelId, label: modelId, provider: 'openai' });
        }
      }

      this.modelsCache = { models: result };
      this.modelsCacheExpiry = now + AUTOFILL_CACHE_TTL_MS;
      return result;
    } catch (error) {
      this.logger.error(
        'Failed to fetch available OpenAI models',
        error as any,
      );
      throw error;
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

    const effectiveModel = modelOverride ?? this.model;
    this.logger.info(
      `[AUTOFILL] start field=${fieldName} promptCode=${promptCode} provider=openai model=${effectiveModel} ` +
        `requestedCount=${(scenarioContext as any)?.numStates ?? (scenarioContext as any)?.numKnowledgeSources ?? 'n/a'} ` +
        `existingFilled=${(scenarioContext as any)?.existingStates || (scenarioContext as any)?.existingKnowledgeSources ? 'yes' : 'no'}`,
    );
    const startedAt = Date.now();

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'user', content: renderedPrompt },
      ];

      const jsonSchema = STRUCTURED_OUTPUT_SCHEMAS[fieldName];

      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        messages,
        ...(jsonSchema && {
          response_format: {
            type: 'json_schema',
            json_schema: jsonSchema,
          },
        }),
      });

      void this.llmUsage.record({
        provider: 'openai',
        model: effectiveModel,
        task: LlmTask.AUTOFILL_FIELD,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        metadata: { field: fieldName, promptCode },
      });

      const content = response.choices?.[0]?.message?.content ?? '';

      if (!content || content.trim() === '') {
        throw new InternalServerErrorException(
          `Empty response from OpenAI for prompt code: ${promptCode}`,
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
   * Field-level Enhance: run an already-rendered enhance prompt (built from a
   * Prompt-Management template by the caller) and return the improved content.
   * `expectJson` switches on JSON-object mode for structured fields (e.g. a
   * state's name + guidelines).
   */
  async enhanceFieldContent(
    fieldName: EnhanceableField,
    promptCode: string,
    variables: Record<string, string>,
    expectJson: boolean,
    modelOverride?: string,
  ): Promise<string> {
    const template = await this.promptSharedService.getPromptByCode(promptCode);
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${promptCode}`,
      );
    }
    const prompt = renderTemplate(template, variables);

    const effectiveModel = modelOverride ?? this.model;
    this.logger.info(
      `[ENHANCE] start field=${fieldName} provider=openai model=${effectiveModel} ` +
        `promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        messages: [{ role: 'user', content: prompt }],
        ...(expectJson && {
          response_format: { type: 'json_object' as const },
        }),
      });

      void this.llmUsage.record({
        provider: 'openai',
        model: effectiveModel,
        task: LlmTask.AUTOFILL_ENHANCE_FIELD,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        metadata: { field: fieldName },
      });

      const content = response.choices?.[0]?.message?.content ?? '';
      const improved = stripMarkdownFences(content).trim();

      if (!improved) {
        throw new InternalServerErrorException(
          `Empty response from OpenAI while enhancing field: ${fieldName}`,
        );
      }

      this.logger.info(
        `[ENHANCE] done  field=${fieldName} model=${effectiveModel} ` +
          `resultLength=${improved.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return improved;
    } catch (error) {
      this.logger.error(
        `[ENHANCE] failed field=${fieldName} model=${effectiveModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }

  /**
   * Generic "render a managed prompt with runtime variables, call the model,
   * return the raw text" primitive. Used by Agent Builder Copilot to generate
   * one Basic Settings field from its own editable prompt code — the caller
   * parses the result per field. `expectJson` switches on json_object mode.
   */
  async generateContentFromPrompt(
    promptCode: string,
    variables: Record<string, string>,
    expectJson: boolean,
    modelOverride?: string,
  ): Promise<string> {
    const template = await this.promptSharedService.getPromptByCode(promptCode);
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${promptCode}`,
      );
    }
    const prompt = renderTemplate(template, variables);

    const effectiveModel = modelOverride ?? this.model;
    this.logger.info(
      `[AGENT_V2] start provider=openai model=${effectiveModel} promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        messages: [{ role: 'user', content: prompt }],
        ...(expectJson && {
          response_format: { type: 'json_object' as const },
        }),
      });

      void this.llmUsage.record({
        provider: 'openai',
        model: effectiveModel,
        task: LlmTask.AUTOFILL_AGENT_FIELD,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        metadata: { promptCode },
      });

      const content = stripMarkdownFences(
        response.choices?.[0]?.message?.content ?? '',
      ).trim();
      if (!content) {
        throw new InternalServerErrorException(
          `Empty response from OpenAI for prompt code: ${promptCode}`,
        );
      }
      this.logger.info(
        `[AGENT_V2] done  provider=openai model=${effectiveModel} promptCode=${promptCode} ` +
          `resultLength=${content.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return content;
    } catch (error) {
      this.logger.error(
        `[AGENT_V2] failed provider=openai model=${effectiveModel} promptCode=${promptCode} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }

}
