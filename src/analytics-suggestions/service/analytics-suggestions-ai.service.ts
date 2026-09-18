import { Injectable, NotFoundException } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';

/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'analytics-suggestions';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';

import {
  SUGGESTION_LLM,
  SUGGESTION_PROMPT_CODES,
} from '../constants/analytics-suggestions.constants';

/** One suggestion exactly as the model returns it — nothing here is trusted yet. */
export interface RawSuggestion {
  title?: unknown;
  body?: unknown;
  rationale?: unknown;
  evidence?: unknown;
  suggestedGoal?: unknown;
  suggestedType?: unknown;
}

@Injectable()
export class AnalyticsSuggestionsAiService {
  private readonly logger = LoggerService.getInstance(
    AnalyticsSuggestionsAiService.name,
  );
  /**
   * The model that served the most recent call.
   *
   * Read by the caller to stamp the rows this run produced. It has to come
   * from the call rather than from config read at construction: the model is
   * resolved per call now, and a fallback means the row would otherwise claim
   * a model that did not produce it.
   */
  private lastModel?: string;

  /**
   * Model that produced the latest result, for provenance on saved rows.
   *
   * Only ever read after a successful call, so the fallback is unreachable in
   * practice. It returns a string rather than throwing because provenance must
   * never be the reason a completed run fails to save.
   */
  get model(): string {
    return this.lastModel ?? 'unknown';
  }

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  /**
   * One generation call.
   *
   * Returns null when the model produced nothing parseable. The caller turns that
   * into an error and stores nothing — unlike the roadmap's AI assists, which
   * degrade to an empty result, a half-read Generate run has no honest partial
   * form: an empty suggestion list is a meaningful answer here ("the data
   * supports nothing"), so it must not double as "the call went wrong".
   */
  async generate(userMessage: string): Promise<RawSuggestion[] | null> {
    const parsed = await this.runJson<{ suggestions?: unknown }>(userMessage);
    if (!parsed) return null;

    if (!Array.isArray(parsed.suggestions)) {
      this.logger.warn(
        '[SUGGESTIONS] Model returned JSON without a `suggestions` array; ' +
          'treating the run as failed rather than as zero suggestions.',
      );
      return null;
    }
    return parsed.suggestions as RawSuggestion[];
  }

  /**
   * JSON-shaped call. Anthropic has no JSON mode and this model family rejects
   * assistant prefill (see run()), so correctness rests on the system prompt
   * asking for bare JSON plus the defensive parsing here.
   */
  private async runJson<T>(userMessage: string): Promise<T | null> {
    const raw = await this.run(userMessage);
    if (!raw) return null;

    // The prompt says "no markdown fences", but strip them anyway and fall back
    // to the first brace-delimited span — the same tolerance RoadmapAiService has
    // for a model that wraps its answer in prose.
    const cleaned = stripMarkdownFences(raw);
    for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
      if (!candidate) continue;
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // try the next candidate
      }
    }
    this.logger.warn(
      `[SUGGESTIONS] Model output was not parseable JSON: ${cleaned.slice(0, 200)}`,
    );
    return null;
  }

  /**
   * The prompt FILE is the system prompt and the analytics payload is a separate
   * user message.
   *
   * This is why the prompt file contains no {{placeholders}}: an admin editing it
   * in Prompt Management cannot delete an interpolation slot and silently break
   * the feature. renderTemplate is still applied so a future revision CAN use
   * variables.
   *
   * ⚠️ NO ASSISTANT PREFILL. claude-sonnet-4-6 rejects it outright:
   *   400 invalid_request_error — "This model does not support assistant message
   *   prefill. The conversation must end with a user message."
   * Do not reintroduce it to force JSON; runJson() parses defensively instead.
   */
  private async run(userMessage: string): Promise<string | null> {
    const template = await this.promptSharedService.getPromptByCode(
      SUGGESTION_PROMPT_CODES.GENERATE,
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${SUGGESTION_PROMPT_CODES.GENERATE}`,
      );
    }
    const systemPrompt = renderTemplate(template, {});

    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.ANALYTICS_SUGGESTIONS,
      promptCode: SUGGESTION_PROMPT_CODES.GENERATE,
      system: systemPrompt,
      prompt: userMessage,
      maxTokens: SUGGESTION_LLM.MAX_TOKENS,
      // Bounded rather than left to the socket: an unbounded hang is
      // indistinguishable to the caller from a run that will never answer.
      timeoutMs: SUGGESTION_LLM.TIMEOUT_MS,
      usageMetadata: { feature: 'analytics-suggestions', label: 'generate' },
    });

    this.lastModel = response.model;

    return response.text || null;
  }
}
