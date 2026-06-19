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
import { AGENT_BUILDER_PROMPT_CODE } from '../constants/agent-builder.constants';
import {
  AUTOFILL_CACHE_TTL_MS,
  buildBehaviorIdMapping,
  buildTemplateVariables,
  extractContent,
  renderTemplate,
  stripMarkdownFences,
} from '../util/autofill-shared.util';
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
      `[AGENT_BUILDER] start provider=openai model=${effectiveModel} descriptionLength=${description.length}`,
    );
    const startedAt = Date.now();

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: metaPrompt },
        { role: 'user', content: description },
      ];

      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        messages,
        // The agent-builder meta prompt now returns a single JSON object
        // configuring the scenario (parsed client-side to auto-fill Basic
        // Settings). json_object mode guarantees syntactically valid JSON.
        response_format: { type: 'json_object' },
      });

      void this.llmUsage.record({
        provider: 'openai',
        model: effectiveModel,
        task: LlmTask.AUTOFILL_AGENT_PROMPT,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      });

      const content = response.choices?.[0]?.message?.content ?? '';

      if (!content.trim()) {
        throw new InternalServerErrorException(
          'Empty response from OpenAI for agent-builder generation',
        );
      }

      this.logger.info(
        `[AGENT_BUILDER] done provider=openai model=${effectiveModel} elapsedMs=${Date.now() - startedAt}`,
      );
      return stripMarkdownFences(content).trim();
    } catch (error) {
      this.logger.error(
        `[AGENT_BUILDER] failed provider=openai model=${effectiveModel} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }

  /**
   * Pick the single best-fit competency from a catalog for a free-text actor
   * brief. Used by the Copilot orchestrator to auto-select a competency when
   * the superadmin only supplies a brief. Returns the chosen competency id, or
   * null when the model can't decide / the response is unparseable (caller
   * falls back to the first competency).
   *
   * Always runs on a small OpenAI model regardless of the builder model — this
   * is a cheap classification, decoupled from actor generation.
   */
  async selectCompetency(
    brief: string,
    competencies: { id: string; name: string }[],
    modelOverride?: string,
  ): Promise<string | null> {
    if (!competencies.length) return null;

    const catalog = competencies
      .map((c, i) => `${i + 1}. id=${c.id} | name=${c.name}`)
      .join('\n');
    const system =
      'You match a roleplay-actor training brief to the single most relevant ' +
      'counseling competency from a catalog. Respond ONLY with JSON: ' +
      '{"competencyId": "<the id of the best-fit competency>"}. The id MUST be ' +
      'one of the ids in the catalog.';
    const user = `Brief:\n${brief}\n\nCompetency catalog:\n${catalog}`;
    const effectiveModel = modelOverride ?? this.model;

    try {
      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      });
      const content = response.choices?.[0]?.message?.content ?? '';
      const parsed = JSON.parse(stripMarkdownFences(content)) as {
        competencyId?: string;
      };
      const chosen = competencies.find((c) => c.id === parsed.competencyId);
      return chosen?.id ?? null;
    } catch (error) {
      this.logger.warn(
        `[COPILOT_COMPETENCY] selection failed on model=${effectiveModel}: ${
          (error as any)?.message ?? error
        }`,
      );
      return null;
    }
  }
}
