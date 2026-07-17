import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
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

const ANTHROPIC_MAX_TOKENS = 4096;

@Injectable()
export class AnthropicAutofillService {
  private readonly logger = LoggerService.getInstance(
    AnthropicAutofillService.name,
  );

  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.model = this.configService.anthropic.autofillModel;
  }

  /**
   * Field-level Enhance: run an already-rendered enhance prompt (built from a
   * Prompt-Management template by the caller) and return the improved content.
   * When `expectJson` is set, the assistant turn is prefilled with `{` so the
   * model is forced to emit a JSON object (Anthropic has no json mode).
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
      `[ENHANCE] start field=${fieldName} provider=anthropic model=${effectiveModel} ` +
        `temperature=${temperatureOverride ?? 'default'} ` +
        `promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.create({
        model: effectiveModel,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(temperatureOverride != null
          ? { temperature: temperatureOverride }
          : {}),
        messages: expectJson
          ? [
              { role: 'user', content: prompt },
              { role: 'assistant', content: '{' },
            ]
          : [{ role: 'user', content: prompt }],
      });

      this.recordUsage(
        response.usage,
        effectiveModel,
        LlmTask.AUTOFILL_ENHANCE_FIELD,
        { field: fieldName },
      );

      const block = response.content[0];
      const raw = block?.type === 'text' ? block.text : '';
      // Re-prepend the prefilled brace for JSON responses — but only if the
      // model didn't already echo it (some versions do), to avoid `{{`.
      const reconstructed =
        expectJson && raw.trim() && !raw.trimStart().startsWith('{')
          ? `{${raw}`
          : raw;
      const improved = stripMarkdownFences(reconstructed).trim();

      if (!improved) {
        throw new InternalServerErrorException(
          `Empty response from Anthropic while enhancing field: ${fieldName}`,
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
   * parses the result per field. When `expectJson` is set the assistant turn is
   * prefilled with `{` so the model is forced to emit a JSON object (Anthropic
   * has no json mode).
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
      `[AGENT_V2] start provider=anthropic model=${effectiveModel} temperature=${temperatureOverride ?? 'default'} promptCode=${promptCode} expectJson=${expectJson}`,
    );
    const startedAt = Date.now();

    try {
      const response = await this.client.messages.create({
        model: effectiveModel,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        ...(temperatureOverride != null
          ? { temperature: temperatureOverride }
          : {}),
        messages: expectJson
          ? [
              { role: 'user', content: prompt },
              { role: 'assistant', content: '{' },
            ]
          : [{ role: 'user', content: prompt }],
      });

      this.recordUsage(
        response.usage,
        effectiveModel,
        LlmTask.AUTOFILL_AGENT_FIELD,
        { promptCode },
      );

      const block = response.content[0];
      const raw = block?.type === 'text' ? block.text : '';
      // Re-prepend the prefilled brace for JSON responses — but only if the
      // model didn't already echo it, to avoid `{{`.
      const reconstructed =
        expectJson && raw.trim() && !raw.trimStart().startsWith('{')
          ? `{${raw}`
          : raw;
      const content = stripMarkdownFences(reconstructed).trim();
      if (!content) {
        throw new InternalServerErrorException(
          `Empty response from Anthropic for prompt code: ${promptCode}`,
        );
      }
      this.logger.info(
        `[AGENT_V2] done  provider=anthropic model=${effectiveModel} promptCode=${promptCode} ` +
          `resultLength=${content.length} elapsedMs=${Date.now() - startedAt}`,
      );
      return content;
    } catch (error) {
      this.logger.error(
        `[AGENT_V2] failed provider=anthropic model=${effectiveModel} promptCode=${promptCode} ` +
          `elapsedMs=${Date.now() - startedAt}: ${(error as any)?.message ?? error}`,
        error as any,
      );
      throw error;
    }
  }

  /** Best-effort token-usage capture from an Anthropic message response. */
  private recordUsage(
    usage: Anthropic.Messages.Usage | undefined,
    model: string,
    task: LlmTask,
    metadata?: Record<string, any>,
  ): void {
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model,
      task,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cache_read_input_tokens ?? undefined,
      metadata,
    });
  }
}
