import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from '../enum/llm-task.enum';
import { EnhanceableField } from '../enum/enhanceable-field.enum';
import {
  renderTemplate,
  stripMarkdownFences,
} from '../util/autofill-shared.util';

const MAX_TOKENS = 4096;

/**
 * Studio autofill: Generate and Enhance for a scenario or Agent Builder field.
 *
 * Replaces the OpenAIAutofillService / AnthropicAutofillService pair, which
 * were the same two methods twice over a different SDK, plus a hand-rolled
 * provider chain in ScenarioService that picked between them. Three copies of
 * one decision, and the model a field ran on depended on which of them you
 * read.
 *
 * Two things that pair got wrong and this does not:
 *
 *  * JSON. OpenAI used its real `json_object` response format while Anthropic
 *    prefilled the assistant turn with `{` — and the Claude 4.6+ family rejects
 *    a trailing assistant message outright ("does not support assistant message
 *    prefill"). Since ANTHROPIC_AUTOFILL_MODEL defaulted to claude-sonnet-4-6,
 *    every JSON-expecting autofill on an Anthropic model was a 400. `jsonMode`
 *    on the completion request now picks the right mechanism per provider.
 *  * Provider reach. That chain accepted only openai and anthropic and silently
 *    ignored a prompt row that selected Gemini, so an admin's choice quietly
 *    did nothing. The provider now follows from the resolved model, so Gemini
 *    works because there is nothing left to special-case.
 */
@Injectable()
export class AutofillService {
  private readonly logger = LoggerService.getInstance(AutofillService.name);

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  /**
   * Field-level Enhance: run an already-rendered enhance prompt and return the
   * improved content. Never invents content — the caller supplies the field's
   * current value as grounding.
   */
  async enhanceFieldContent(
    fieldName: EnhanceableField,
    promptCode: string,
    variables: Record<string, string>,
    expectJson: boolean,
    modelOverride?: string,
    temperatureOverride?: number,
    providerOverride?: string,
  ): Promise<string> {
    return this.run({
      taskId: 'autofill-enhance-field',
      task: LlmTask.AUTOFILL_ENHANCE_FIELD,
      label: `field=${fieldName}`,
      promptCode,
      variables,
      expectJson,
      modelOverride,
      temperatureOverride,
      providerOverride,
      usageMetadata: { field: fieldName },
      requireContent: true,
    });
  }

  /** Agent Builder generation: one abortable call per field, run in parallel. */
  async generateContentFromPrompt(
    promptCode: string,
    variables: Record<string, string>,
    expectJson: boolean,
    modelOverride?: string,
    temperatureOverride?: number,
    providerOverride?: string,
  ): Promise<string> {
    return this.run({
      taskId: 'autofill-agent-field',
      task: LlmTask.AUTOFILL_AGENT_FIELD,
      label: `promptCode=${promptCode}`,
      promptCode,
      variables,
      expectJson,
      modelOverride,
      temperatureOverride,
      providerOverride,
    });
  }

  private async run(options: {
    taskId: string;
    task: LlmTask;
    label: string;
    promptCode: string;
    variables: Record<string, string>;
    expectJson: boolean;
    modelOverride?: string;
    temperatureOverride?: number;
    /**
     * Explicit provider from the request. Rarely set — the provider normally
     * follows from the model id — but the DTO accepts one, and silently
     * ignoring it would make an admin's explicit choice do nothing.
     */
    providerOverride?: string;
    usageMetadata?: Record<string, any>;
    /** Whether an empty result is an error. Enhance says yes; generate says no. */
    requireContent?: boolean;
  }): Promise<string> {
    const template = await this.promptSharedService.getPromptByCode(
      options.promptCode,
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found for code: ${options.promptCode}`,
      );
    }
    const prompt = renderTemplate(template, options.variables);
    const startedAt = Date.now();

    const response = await this.llmCompletion.complete({
      taskId: options.taskId,
      task: options.task,
      promptCode: options.promptCode,
      prompt,
      maxTokens: MAX_TOKENS,
      jsonMode: options.expectJson,
      model: options.modelOverride,
      provider: options.providerOverride,
      temperature: options.temperatureOverride,
      usageMetadata: options.usageMetadata,
    });

    // Fences are stripped whatever the provider: every model family wraps a
    // JSON answer in ```json sometimes, and the callers parse this string.
    const text = stripMarkdownFences(response.text).trim();

    if (options.requireContent && !text) {
      throw new InternalServerErrorException(
        `Empty response from ${response.provider} while enhancing ` +
          `${options.label}`,
      );
    }

    // Model and provider come from the response, not from config read up front:
    // a fallback means the value here would otherwise name something that did
    // not produce this content.
    this.logger.info(
      `[AUTOFILL] ${options.label} provider=${response.provider} ` +
        `model=${response.model} source=${response.source} ` +
        `json=${options.expectJson} chars=${text.length} ` +
        `elapsedMs=${Date.now() - startedAt}`,
    );
    if (response.fellBackFrom) {
      this.logger.warn(
        `[AUTOFILL] ${options.label} fell back from ` +
          `${response.fellBackFrom.provider}/${response.fellBackFrom.model}: ` +
          response.fellBackFrom.reason,
      );
    }

    return text;
  }
}
