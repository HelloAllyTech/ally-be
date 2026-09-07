import { Injectable, NotFoundException } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';

import {
  UX_SIGNAL_LLM,
  UX_SIGNAL_PROMPT_CODES,
} from '../constants/ux-signals.constants';
import { RawTriageItem } from '../ux-signals.types';

/** AI-task-registry row id; the key for per-task model config. */
const AI_TASK_ID = 'ux-signals';

/**
 * The one LLM call in a scan: threshold-crossing signals in, clustered and
 * classified items out.
 *
 * Mirrors AnalyticsSuggestionsAiService deliberately — same prompt-file-as-system
 * -prompt convention, same defensive JSON parsing, same mandatory metering. The
 * two are near-identical because the platform has no shared agent-runner
 * abstraction; when one is written, both should move to it together.
 */
@Injectable()
export class UxSignalsAiService {
  private readonly logger = LoggerService.getInstance(UxSignalsAiService.name);
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
   * One triage call.
   *
   * Returns null when the model produced nothing parseable, which the caller
   * turns into a failed scan. That is not the same as an empty array: an empty
   * array is a real answer ("every signal is already filed or rejected") and must
   * never be conflated with a call that went wrong, because the scan's counts are
   * what a human reads to decide whether the pipeline is working.
   */
  async triage(userMessage: string): Promise<RawTriageItem[] | null> {
    const parsed = await this.runJson<{ items?: unknown }>(userMessage);
    if (!parsed) return null;

    if (!Array.isArray(parsed.items)) {
      this.logger.warn(
        '[UX-SIGNALS] Model returned JSON without an `items` array; ' +
          'treating the scan as failed rather than as zero items.',
      );
      return null;
    }
    return parsed.items as RawTriageItem[];
  }

  /**
   * JSON-shaped call. Anthropic has no JSON mode and this model family rejects
   * assistant prefill (see run()), so correctness rests on the system prompt
   * asking for bare JSON plus the defensive parsing here.
   */
  private async runJson<T>(userMessage: string): Promise<T | null> {
    const raw = await this.run(userMessage);
    if (!raw) return null;

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
      `[UX-SIGNALS] Model output was not parseable JSON: ${cleaned.slice(0, 200)}`,
    );
    return null;
  }

  /**
   * The prompt FILE is the system prompt; the signal payload is a separate user
   * message. This is why the prompt file contains no {{placeholders}}: an admin
   * editing it in Prompt Management cannot delete an interpolation slot and
   * silently break the scan. renderTemplate is still applied so a future revision
   * CAN use variables.
   *
   * ⚠️ NO ASSISTANT PREFILL — the model family rejects it outright
   * ("This model does not support assistant message prefill"). Do not reintroduce
   * it to force JSON; runJson() parses defensively instead.
   */
  private async run(userMessage: string): Promise<string | null> {
    const template = await this.promptSharedService.getPromptByCode(
      UX_SIGNAL_PROMPT_CODES.TRIAGE,
    );
    if (!template) {
      throw new NotFoundException(
        `Prompt template not found: ${UX_SIGNAL_PROMPT_CODES.TRIAGE}`,
      );
    }
    const systemPrompt = renderTemplate(template, {});

    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.UX_SIGNALS,
      promptCode: UX_SIGNAL_PROMPT_CODES.TRIAGE,
      system: systemPrompt,
      prompt: userMessage,
      maxTokens: UX_SIGNAL_LLM.MAX_TOKENS,
      // Bounded rather than left to the socket: an unbounded hang is
      // indistinguishable to the caller from a run that will never answer.
      timeoutMs: UX_SIGNAL_LLM.TIMEOUT_MS,
      usageMetadata: { feature: 'ux-signals', label: 'triage' },
    });

    this.lastModel = response.model;

    return response.text || null;
  }
}
