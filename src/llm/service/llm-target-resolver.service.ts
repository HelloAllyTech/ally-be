import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { providerForModel } from 'src/llm-agent/service/agent-llm.factory';
import { LlmModelTier } from '../constants/llm-tier.constants';

/** Which layer of the chain supplied the model that will run. */
export enum LlmTargetSource {
  /** The call site passed an explicit model — an AI Lab run, a replay. */
  REQUEST = 'request',
  /** The prompt row's own provider/model, set in System Skills. */
  PROMPT = 'prompt',
  /** The platform tier default (LLM_FAST_MODEL / LLM_REASONING_MODEL). */
  TIER = 'tier',
}

export interface ResolveLlmTargetOptions {
  /** AI-task-registry row id. Identifies the call in logs and on the screen. */
  taskId: string;
  /**
   * What this call needs when no prompt row names a model. From the registry.
   *
   * Optional only so a caller can supply `fallbackModel` instead — see below.
   * One of the two must be present or there is no floor to land on.
   */
  tier?: LlmModelTier;
  /**
   * A concrete model to use as the floor instead of the tier.
   *
   * For calls that own their own default rather than sharing the platform
   * tiers: the character interview drives AgentLlmProviderFactory directly and
   * reads `characterInterview.model`. Without this, the AI Tasks screen had to
   * choose between resolving the prompt row (accurate about the override,
   * blind to that env var) and reading the env var (accurate about the
   * default, blind to the override). It now does both, in the order the
   * orchestrator itself uses.
   */
  fallbackModel?: string;
  /** Prompt whose row may carry a provider/model/temperature. */
  promptCode?: string;
  /** Explicit override from the call site. Beats every configured layer. */
  model?: string;
  provider?: string;
  temperature?: number;
  /**
   * True for a task whose output is stored and compared over time, where a
   * quiet substitution is worse than a failure. Comes from the registry row.
   */
  neverFallback?: boolean;
}

export interface ResolvedLlmTarget {
  provider: string;
  model: string;
  temperature?: number;
  source: LlmTargetSource;
  /** Whether a runtime failure may be retried on `tierModel`. */
  fallbackEnabled: boolean;
  /**
   * The tier's model, carried alongside so a caller that fails can retry
   * without re-resolving — and so `source === TIER` is distinguishable from
   * "resolved elsewhere but the tier happens to name the same model".
   */
  tierModel: string;
}

/**
 * Resolves which (provider, model, temperature) actually serves one AI task.
 *
 * The chain, highest priority first:
 *
 *   explicit argument -> prompt row -> platform tier -> compiled-in floor
 *
 * Deliberately no per-task config table. One was built and removed: the AI
 * Tasks screen is a read-only report, so nothing would have written it, and an
 * unwritten table is just a second place a model id could be recorded — the
 * duplication this work exists to remove. The rungs that remain are both
 * pre-existing surfaces: `prompts.provider/model/temperature`, already
 * admin-editable in System Skills and already loaded on these call paths, and
 * two env vars for the tiers.
 *
 * Each layer is skipped when it names nothing, which is what the nullable model
 * column on `prompts` already means. `source` comes back with the value because
 * "gpt-4o-mini" alone does not tell an admin whether a prompt-row override took
 * effect — and reporting that honestly is the difference between a registry and
 * a document.
 */
@Injectable()
export class LlmTargetResolverService {
  private readonly logger = new Logger(LlmTargetResolverService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
  ) {}

  async resolve(options: ResolveLlmTargetOptions): Promise<ResolvedLlmTarget> {
    const tierModel =
      options.fallbackModel?.trim() ||
      (options.tier ? this.configService.llmTiers[options.tier] : undefined);
    if (!tierModel) {
      throw new Error(
        `Cannot resolve AI task "${options.taskId}": no tier and no fallback ` +
          `model, so there is no floor to land on.`,
      );
    }
    const promptRow = options.promptCode
      ? await this.promptRow(options.promptCode)
      : undefined;

    // Ordered highest priority first; the first layer naming a model wins.
    const layers: [LlmTargetSource, Selection | undefined][] = [
      [LlmTargetSource.REQUEST, options],
      [LlmTargetSource.PROMPT, promptRow],
      [LlmTargetSource.TIER, { model: tierModel }],
    ];

    const [source, winner] = layers.find(([, layer]) =>
      layer?.model?.trim(),
    ) as [LlmTargetSource, Selection];

    const model = winner.model!.trim();
    return {
      model,
      // An explicit provider on the winning layer is authoritative. Otherwise
      // infer from the model id, which is what the agent factory does for
      // models the catalog has not caught up with yet.
      provider: winner.provider?.trim() || providerForModel(model) || 'openai',
      // Temperature resolves independently: a prompt row may tune a
      // temperature without naming a model, and the providers already drop it
      // for models that reject one.
      temperature: this.resolveTemperature(options, promptRow),
      source,
      fallbackEnabled: !options.neverFallback,
      tierModel,
    };
  }

  private resolveTemperature(
    ...layers: (Selection | undefined)[]
  ): number | undefined {
    return layers.find((layer) => typeof layer?.temperature === 'number')
      ?.temperature;
  }

  private async promptRow(promptCode: string): Promise<Selection | undefined> {
    try {
      const config =
        await this.promptSharedService.getPromptLlmConfig(promptCode);
      return {
        provider: config.provider,
        model: config.model,
        temperature: config.temperature,
      };
    } catch (error) {
      // A prompt row that cannot be read must not take the call down with it:
      // the tier default is a correct answer, just not the tuned one.
      this.logger.warn(
        `[LLM-TARGET] Could not read prompt config for "${promptCode}". ${
          (error as Error)?.message ?? error
        }`,
      );
      return undefined;
    }
  }
}

interface Selection {
  provider?: string;
  model?: string;
  temperature?: number;
}
