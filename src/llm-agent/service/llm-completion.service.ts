import { Injectable, Logger } from '@nestjs/common';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmModelTier } from 'src/llm/constants/llm-tier.constants';
import {
  LlmTargetResolverService,
  LlmTargetSource,
  ResolvedLlmTarget,
} from 'src/llm/service/llm-target-resolver.service';
import { AgentMessage, AgentUsage } from '../type/agent-llm.type';
import { AgentLlmProviderFactory } from './agent-llm.factory';

export interface LlmCompletionRequest {
  /** AI-task-registry row id. Identifies the call for config and for the screen. */
  taskId: string;
  /** Usage label written to `llm_usage.task`. Null for calls that record none. */
  task: LlmTask | null;
  /** Tier used when no row selects a model. A property of the call, not config. */
  tier: LlmModelTier;
  /** System instruction. Empty string when the prompt carries everything. */
  system?: string;
  /** Convenience for the common single-user-turn shape. */
  prompt?: string;
  /** Full message list, for callers that need more than one turn. */
  messages?: AgentMessage[];
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  /** Prompt row whose provider/model may override the task row. */
  promptCode?: string;
  /** Explicit override, above every configured layer. */
  model?: string;
  provider?: string;
  /** Passed through to the usage row for cost attribution. */
  usageMetadata?: Record<string, any>;
  scenarioSessionId?: string;
}

export interface LlmCompletionResult {
  text: string;
  /** What actually ran, which is not always what was asked for. */
  provider: string;
  model: string;
  source: LlmTargetSource;
  usage: AgentUsage;
  /**
   * Set when the selected target failed and the tier default served the call
   * instead. Present on the result rather than only in the logs because a
   * caller storing this output needs to be able to record which model produced
   * it — a score or a summary is not comparable across models.
   */
  fellBackFrom?: { provider: string; model: string; reason: string };
}

/** Errors worth retrying elsewhere: the provider is unusable, not the request. */
const isRetryableProviderFailure = (error: any): boolean => {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  if (typeof status === 'number') {
    // 401/403 — the credential is dead or revoked. This is the case that
    // started all of this: a key that is present, so every "is it configured"
    // check passes, and invalid, so every call fails.
    // 404 — the model id was retired under us.
    // 408/429/5xx — transient or capacity.
    return (
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 408 ||
      status === 429 ||
      status >= 500
    );
  }
  // No status: a socket hangup, a DNS failure, or our own timeout. Retryable —
  // the request never reached a model, so nothing about it was rejected.
  return true;
};

/**
 * One provider-agnostic, non-streaming LLM call.
 *
 * Replaces ten services that each held `new Anthropic(...)` and read
 * `configService.anthropic.autofillModel`. Because the model and the SDK were
 * one decision made ten times, moving a task to another vendor meant editing
 * that service — and when the shared Anthropic credential lapsed, all ten died
 * together with no lever to move them. Here the model is resolved config and
 * the SDK follows from it, so the same incident is a row edit.
 *
 * Built on the existing `IAgentLlmProvider.stream` rather than a fourth set of
 * provider adapters: a one-shot completion is a stream nobody watches, and the
 * three adapters plus their factory (key checks, model -> provider inference,
 * temperature dropping for models that reject one) are already tested. The
 * only thing this adds is the fallback and the usage row.
 */
@Injectable()
export class LlmCompletionService {
  private readonly logger = new Logger(LlmCompletionService.name);

  constructor(
    private readonly resolver: LlmTargetResolverService,
    private readonly factory: AgentLlmProviderFactory,
    private readonly llmUsage: LlmUsageService,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const target = await this.resolver.resolve({
      taskId: request.taskId,
      tier: request.tier,
      promptCode: request.promptCode,
      model: request.model,
      provider: request.provider,
      temperature: request.temperature,
    });

    try {
      return await this.run(request, target);
    } catch (error) {
      const fallback = this.fallbackTarget(target);
      if (!fallback || !isRetryableProviderFailure(error)) {
        throw error;
      }

      const reason = (error as Error)?.message ?? String(error);
      this.logger.warn(
        `[LLM-FALLBACK] ${request.taskId}: ${target.provider}/${target.model} ` +
          `failed (${reason}); retrying on ${fallback.provider}/${fallback.model}`,
      );

      const result = await this.run(request, fallback);
      return {
        ...result,
        fellBackFrom: {
          provider: target.provider,
          model: target.model,
          reason,
        },
      };
    }
  }

  /**
   * The tier default, or undefined when there is nothing to fall back to.
   *
   * Nothing to fall back to means: the task opted out (its output is stored and
   * trended, so a quiet substitution is worse than a failure), the tier default
   * is already what just failed, or its provider has no key here — in which
   * case retrying would fail for a second, more confusing reason.
   */
  private fallbackTarget(
    target: ResolvedLlmTarget,
  ): ResolvedLlmTarget | undefined {
    if (!target.fallbackEnabled) return undefined;
    if (target.model === target.tierModel) return undefined;

    const provider = 'openai';
    if (!this.factory.isConfigured(provider)) return undefined;

    return {
      ...target,
      provider,
      model: target.tierModel,
      source: LlmTargetSource.TIER,
      // Temperature is dropped: it was tuned for the model that just failed,
      // and the tier default may not even accept a custom one.
      temperature: undefined,
    };
  }

  private async run(
    request: LlmCompletionRequest,
    target: ResolvedLlmTarget,
  ): Promise<LlmCompletionResult> {
    const provider = this.factory.create(target.provider, target.model);

    const stream = provider.stream({
      model: target.model,
      system: request.system ?? '',
      messages: this.toMessages(request),
      maxTokens: request.maxTokens,
      ...(target.temperature !== undefined
        ? { temperature: target.temperature }
        : {}),
      ...(request.timeoutMs !== undefined
        ? { timeoutMs: request.timeoutMs }
        : {}),
    });

    let text = '';
    let usage: AgentUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of stream) {
      if (event.type === 'final') {
        // Read the assembled turn rather than the deltas: identical text, and
        // it is the only place usage arrives.
        text = event.message.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as { text: string }).text)
          .join('');
        usage = event.message.usage;
      }
    }

    void this.llmUsage.record({
      provider: provider.name,
      model: target.model,
      task: request.task ?? LlmTask.UNKNOWN,
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      scenarioSessionId: request.scenarioSessionId,
      metadata: {
        ...(request.usageMetadata ?? {}),
        aiTaskId: request.taskId,
        modelSource: target.source,
      },
    });

    return {
      text: text.trim(),
      provider: provider.name,
      model: target.model,
      source: target.source,
      usage,
    };
  }

  private toMessages(request: LlmCompletionRequest): AgentMessage[] {
    if (request.messages?.length) return request.messages;
    return [{ role: 'user', content: request.prompt ?? '' }];
  }
}
