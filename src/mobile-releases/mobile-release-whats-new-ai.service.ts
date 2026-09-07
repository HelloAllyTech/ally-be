import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmModelTier } from 'src/llm/constants/llm-tier.constants';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';

/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'mobile-release-whats-new';

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

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

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
      const response = await this.llmCompletion.complete({
        taskId: AI_TASK_ID,
        task: LlmTask.MOBILE_RELEASE_WHATS_NEW,
        tier: LlmModelTier.FAST,
        promptCode: WHATS_NEW_PROMPT_CODE,
        system: systemPrompt,
        prompt: "Generate the What's New text.",
        maxTokens: WHATS_NEW_LLM.MAX_TOKENS,
        // Bounded rather than left to the socket: an unbounded hang is
        // indistinguishable to the caller from a run that will never answer.
        timeoutMs: WHATS_NEW_LLM.TIMEOUT_MS,
        usageMetadata: {
          feature: 'mobile-releases',
          label: 'ios-whats-new-suggestion',
        },
      });

      if (!response.text) {
        throw new Error('Model returned no usable text content');
      }
      return response.text;
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
