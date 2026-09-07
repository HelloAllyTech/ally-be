import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmConfigService } from 'src/learn/service/llm-config.service';
import { LlmModelService } from 'src/llm/service/llm-model.service';
import { AgentLlmProviderFactory } from 'src/llm-agent/service/agent-llm.factory';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmPreviewResult } from './providers/llm-provider.interface';
import { describeProviderError } from './providers/provider-error.util';
import { assertPreviewable } from './providers/preview-target.util';

/**
 * Smallest prompt that still proves the round trip: the model has to read an
 * instruction and produce a token. Deliberately fixed rather than caller-supplied
 * so every preview costs the same and results are comparable across models.
 */
export const PREVIEW_PROMPT = 'Reply with the single word: ok';

/** Providers get this long before we give up. Long enough for a cold start on a
 *  large model, short enough that the admin UI is not left hanging. */
export const PREVIEW_TIMEOUT_MS = 20_000;

/**
 * Output cap. A preview only has to prove a token comes back, and a model that
 * ignores the instruction and monologues should still cost almost nothing.
 */
const PREVIEW_MAX_TOKENS = 32;

/** AI-task-registry row id; the key for this call's config and reporting. */
const AI_TASK_ID = 'llm-preview';

export interface LlmPreviewResponse extends LlmPreviewResult {
  configName: string;
  provider: string;
  model: string;
}

/**
 * The bench for trying a model before saving it against a prompt.
 *
 * Runs through `LlmCompletionService` rather than holding its own three
 * provider clients. Those clients were the fourth copy of the same SDK
 * plumbing in this repo, and the last one left after the autofill collapse.
 *
 * What did NOT move is this feature's contract, which is the opposite of every
 * other caller's: a provider rejecting the call is the ANSWER, not a failure.
 * So `complete()` — which throws, and which retries elsewhere for anything that
 * looks like an unusable provider — is wrapped here into `ok: false` plus the
 * vendor's own wording. The registry row carries `neverFallback`, because a
 * preview answered by a substitute model would be worse than useless: it would
 * report a model as working when nobody tested it.
 */
@Injectable()
export class LlmPreviewService {
  constructor(
    private readonly llmConfigService: LlmConfigService,
    private readonly llmModelService: LlmModelService,
    private readonly llmCompletion: LlmCompletionService,
    private readonly agentFactory: AgentLlmProviderFactory,
  ) {}

  /**
   * Test a catalog model against its provider.
   *
   * The catalog replaced llm_configs as the thing an admin edits, so this is
   * the preview that matters now. A catalog row has no temperature — that is a
   * per-prompt concern — so the call goes out with the provider's default.
   */
  async previewModel(modelId: string): Promise<LlmPreviewResponse> {
    const row = (await this.llmModelService.getCatalog()).find(
      (model) => model.id === modelId,
    );
    if (!row) {
      throw new NotFoundException('Model not found');
    }

    return {
      ...(await this.run(row.provider, row.model)),
      configName: row.label,
      provider: row.provider,
      model: row.model,
    };
  }

  async previewConfig(configId: string): Promise<LlmPreviewResponse> {
    const config = await this.llmConfigService.getConfigById(configId);
    if (!config) {
      throw new NotFoundException('LLM config not found');
    }

    const model = String(config.config?.model ?? '');
    const temperature =
      typeof config.config?.temperature === 'number'
        ? config.config.temperature
        : undefined;

    return {
      ...(await this.run(config.provider, model, temperature)),
      configName: config.name,
      provider: config.provider,
      model,
    };
  }

  /**
   * One preview round trip, with the provider's verdict returned as data.
   *
   * Misconfiguration (unknown or local-only provider, no model) raises before
   * anything is sent — that is our problem, not the model's.
   */
  private async run(
    provider: string,
    model: string,
    temperature?: number,
  ): Promise<LlmPreviewResult> {
    const normalised = assertPreviewable(provider, model);

    // Checked here rather than left to the call: a key missing on this
    // environment is OUR misconfiguration, so it raises, while everything the
    // vendor says comes back as data. Without this the two would be
    // indistinguishable to an admin — a blank environment would read as "the
    // model is broken".
    if (!this.agentFactory.isConfigured(normalised)) {
      throw new BadRequestException(
        `Provider ${normalised} is not configured on this environment. Please contact your administrator.`,
      );
    }

    const startedAt = Date.now();

    try {
      const response = await this.llmCompletion.complete({
        taskId: AI_TASK_ID,
        task: LlmTask.LLM_PREVIEW,
        // Explicit, so the resolution chain cannot substitute anything: the
        // point of this call is to test THIS model, not whatever config would
        // otherwise serve the task.
        provider: normalised,
        model,
        prompt: PREVIEW_PROMPT,
        maxTokens: PREVIEW_MAX_TOKENS,
        temperature,
        timeoutMs: PREVIEW_TIMEOUT_MS,
      });

      return {
        ok: true,
        text: response.text,
        latencyMs: Date.now() - startedAt,
        promptTokens: response.usage.inputTokens,
        completionTokens: response.usage.outputTokens,
      };
    } catch (error: unknown) {
      // The failure IS the result. `describeProviderError` keeps the vendor's
      // wording verbatim — "The model `gpt-4o-mini` has been deprecated" tells
      // an admin what to do; a normalised "request failed" tells them nothing.
      return {
        ok: false,
        text: '',
        latencyMs: Date.now() - startedAt,
        error: describeProviderError(error),
      };
    }
  }
}
