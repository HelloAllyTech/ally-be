import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';

import {
  ClusterInput,
  OpenUpdateInput,
  ParsedConsolidation,
  buildConsolidationInput,
  parseConsolidationOutput,
} from '../util/consolidation.util';

const AI_TASK_ID = 'product-updates-consolidate';
const PROMPT_CODE = 'product_updates_consolidate';

/**
 * A batch is up to 20 clusters, each answered with a title, summary and a
 * handful of team-note bullets. Reasoning tokens count against the budget on
 * the reasoning tier, and a reply cut off mid-JSON decides nothing — so the
 * budget is set well above the ~10k a 30-cluster batch was measured at.
 * gpt-5 (the prompt's default) took 2.5–3 minutes per 20-cluster batch with
 * open updates in the prompt; the timeout leaves room for a slow one, since a
 * timed-out call is wasted and retried on the tier model.
 */
const CONSOLIDATION_LLM = { MAX_TOKENS: 32000, TIMEOUT_MS: 480_000 };

/**
 * The one model call in product updates: a batch of clustered merges and the
 * updates still open → decisions (new update, attach to an open one, or
 * noise) with the words for each.
 *
 * The prompt file is the whole system prompt with no placeholders; the batch
 * goes in as the user message, so an admin editing the prompt in System Skills
 * cannot delete the slot the data arrives through (the pattern UX Signals
 * uses for the same reason).
 */
@Injectable()
export class ProductUpdatesAiService {
  private readonly logger = LoggerService.getInstance(
    ProductUpdatesAiService.name,
  );

  constructor(
    private readonly promptSharedService: PromptSharedService,
    private readonly llmCompletion: LlmCompletionService,
  ) {}

  async consolidate(
    clusters: ClusterInput[],
    openUpdates: OpenUpdateInput[],
  ): Promise<{ parsed: ParsedConsolidation; model: string }> {
    const template =
      await this.promptSharedService.getPromptByCode(PROMPT_CODE);
    if (!template) {
      throw new ServiceUnavailableException(
        `Prompt template not found: ${PROMPT_CODE}`,
      );
    }

    const response = await this.llmCompletion.complete({
      taskId: AI_TASK_ID,
      task: LlmTask.PRODUCT_UPDATES_CONSOLIDATION,
      promptCode: PROMPT_CODE,
      system: renderTemplate(template, {}),
      prompt: buildConsolidationInput(clusters, openUpdates),
      maxTokens: CONSOLIDATION_LLM.MAX_TOKENS,
      timeoutMs: CONSOLIDATION_LLM.TIMEOUT_MS,
      jsonMode: true,
      usageMetadata: {
        feature: 'product-updates',
        label: 'consolidate',
        clusters: clusters.length,
      },
    });

    const parsed = parseConsolidationOutput(
      response.text ?? '',
      clusters.map((cluster) => cluster.id),
      openUpdates.map((update) => update.id),
    );
    if (parsed.problems.length) {
      this.logger.warn(
        `[PRODUCT-UPDATES] ${parsed.problems.length} problem(s) in the model reply: ${parsed.problems
          .slice(0, 5)
          .join(' ')}`,
      );
    }
    return { parsed, model: response.model };
  }
}
