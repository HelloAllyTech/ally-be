import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';

/**
 * Prompt code resolved through PromptSharedService (folder file, or a
 * dashboard override once an admin edits it). Flat file, no subdir:
 * src/prompts/mobile_release_whats_new.txt.
 */
const WHATS_NEW_PROMPT_CODE = 'mobile_release_whats_new';

/**
 * Anthropic call shape for the one generation call per request. Small and
 * fast relative to AnalyticsSuggestionsAiService's SUGGESTION_LLM: the input
 * here is a short list of commit subjects (not a whole analytics window) and
 * the output is a few marketing-copy bullet points, not a JSON array.
 */
const WHATS_NEW_LLM = {
  MAX_TOKENS: 1024,
  TIMEOUT_MS: 30_000,
} as const;

/**
 * Turns raw ally-mobile commit subjects since the last release into a
 * polished, user-facing "What's New in This Version" draft for the App
 * Store submission — same Anthropic-SDK + PromptSharedService pattern as
 * AnalyticsSuggestionsAiService, just a single free-text call instead of a
 * JSON-shaped one (there is nothing here to parse: the whole response text
 * IS the suggestion).
 */
@Injectable()
export class MobileReleaseWhatsNewAiService {
  private readonly logger = LoggerService.getInstance(
    MobileReleaseWhatsNewAiService.name,
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
   * `commitSubjects` is the non-merge commit subject lines since the last
   * release point, oldest-to-newest or newest-to-oldest — order as returned
   * by the caller; the prompt doesn't depend on it. Caller is responsible
   * for the "zero commits -> null, don't call this" branch; this method
   * always calls the model and always returns text (or throws).
   */
  async generateSuggestion(commitSubjects: string[]): Promise<string> {
    const template = await this.promptSharedService.getPromptByCode(
      WHATS_NEW_PROMPT_CODE,
    );
    if (!template) {
      throw new ServiceUnavailableException(
        `Prompt template not found: ${WHATS_NEW_PROMPT_CODE}`,
      );
    }

    const systemPrompt = renderTemplate(template, {
      commits: commitSubjects.map((subject) => `- ${subject}`).join('\n'),
    });

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: WHATS_NEW_LLM.MAX_TOKENS,
          system: systemPrompt,
          messages: [
            { role: 'user', content: "Generate the What's New text." },
          ],
        },
        // Bounded rather than left to the socket: an admin is waiting
        // synchronously on this request.
        { timeout: WHATS_NEW_LLM.TIMEOUT_MS },
      );

      // Cost accounting is mandatory in ally-be; an un-metered LLM call is a
      // billing blind spot. Fire-and-forget: metering must never fail the
      // request.
      const input = response.usage?.input_tokens ?? 0;
      const output = response.usage?.output_tokens ?? 0;
      void this.llmUsage.record({
        provider: 'anthropic',
        model: this.model,
        task: LlmTask.MOBILE_RELEASE_WHATS_NEW,
        promptTokens: input,
        completionTokens: output,
        totalTokens: input + output,
        cachedTokens: response.usage?.cache_read_input_tokens ?? undefined,
        metadata: {
          feature: 'mobile-releases',
          label: 'ios-whats-new-suggestion',
        },
      });

      const block = response.content?.[0];
      if (!block || block.type !== 'text' || !block.text.trim()) {
        throw new Error('Model returned no usable text content');
      }
      return block.text.trim();
    } catch (error) {
      this.logger.error(
        `Could not generate the iOS What's New suggestion: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        `Could not generate the iOS What's New suggestion: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
