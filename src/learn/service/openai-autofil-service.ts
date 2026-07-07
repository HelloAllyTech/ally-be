import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import {
  renderTemplate,
  stripMarkdownFences,
} from '../util/autofill-shared.util';
import { EnhanceableField } from '../enum/enhanceable-field.enum';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from '../enum/llm-task.enum';

@Injectable()
export class OpenAIAutofillService {
  private readonly logger = LoggerService.getInstance(
    OpenAIAutofillService.name,
  );

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.model = this.configService.openai.autofillModel;
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
    temperatureOverride?: number,
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
        `temperature=${temperatureOverride ?? 'default'} ` +
        `promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        ...(temperatureOverride != null
          ? { temperature: temperatureOverride }
          : {}),
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
    temperatureOverride?: number,
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
      `[AGENT_V2] start provider=openai model=${effectiveModel} temperature=${temperatureOverride ?? 'default'} promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: effectiveModel,
        ...(temperatureOverride != null
          ? { temperature: temperatureOverride }
          : {}),
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
