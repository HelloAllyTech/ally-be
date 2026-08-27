import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  renderTemplate,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';

import {
  UX_SIGNAL_LLM,
  UX_SIGNAL_PROMPT_CODES,
} from '../constants/ux-signals.constants';
import { RawTriageItem } from '../ux-signals.types';

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
  private readonly client: Anthropic;
  readonly model: string;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    // Shares the suggestions model: this call has the same shape — a payload of
    // aggregates in, a short structured list out — so there is one model to
    // upgrade rather than two that drift.
    this.model = this.configService.anthropic.suggestionsModel;
  }

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

    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: UX_SIGNAL_LLM.MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
      { timeout: UX_SIGNAL_LLM.TIMEOUT_MS },
    );

    // Cost accounting is mandatory in ally-be; an un-metered LLM call is a
    // billing blind spot. Fire-and-forget: metering must never fail the scan.
    const input = response.usage?.input_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model: this.model,
      task: LlmTask.UX_SIGNALS,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: response.usage?.cache_read_input_tokens ?? undefined,
      metadata: { feature: 'ux-signals', label: 'triage' },
    });

    const block = response.content?.[0];
    if (!block || block.type !== 'text') return null;
    return block.text;
  }
}
