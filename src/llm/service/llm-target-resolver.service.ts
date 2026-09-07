import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { providerForModel } from 'src/llm-agent/service/agent-llm.factory';
import { LlmModelTier } from '../constants/llm-tier.constants';
import { LlmTaskConfigRepository } from '../repository/llm-task-config.repository';

/** Which layer of the chain supplied the model that will run. */
export enum LlmTargetSource {
  /** The call site passed an explicit model — a test bench, a replay. */
  REQUEST = 'request',
  /** The prompt row's own provider/model, set in prompt management. */
  PROMPT = 'prompt',
  /** The per-task row in `llm_task_configs`, set on the AI Tasks screen. */
  TASK = 'task',
  /** The platform tier default (LLM_FAST_MODEL / LLM_REASONING_MODEL). */
  TIER = 'tier',
}

export interface ResolveLlmTargetOptions {
  /** AI-task-registry row id. The key everything else hangs off. */
  taskId: string;
  /** What this call needs when nothing selects a model for it. */
  tier: LlmModelTier;
  /** Prompt whose row may carry a provider/model/temperature. */
  promptCode?: string;
  /** Explicit override from the call site. Beats every configured layer. */
  model?: string;
  provider?: string;
  temperature?: number;
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
 *   explicit argument -> prompt row -> task row -> platform tier -> floor
 *
 * Each layer is skipped when it names nothing, which is what every nullable
 * model column in this schema already means. The layers are ordered by how
 * specific the intent is, not by how easy they are to read: a call site that
 * passes a model has been told to use exactly that one, a prompt row is a
 * decision about a particular prompt, and a task row is a decision about the
 * task as a whole.
 *
 * `source` comes back with the value because "gpt-4o-mini" alone does not tell
 * an admin whether their edit took effect. The AI Tasks screen shows it, which
 * is the difference between a registry and a document.
 */
@Injectable()
export class LlmTargetResolverService {
  private readonly logger = new Logger(LlmTargetResolverService.name);

  /**
   * Task rows, cached briefly.
   *
   * These are read on request paths and change a few times a month, so a
   * per-call query would be pure overhead. The TTL is short enough that an
   * admin who switches a task sees it take effect while still on the screen —
   * which matters, because the reason to switch a task is usually that it is
   * currently failing.
   */
  private cache?: { at: number; rows: Map<string, TaskRowSelection> };
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    private readonly configService: AppConfigService,
    private readonly taskConfigRepository: LlmTaskConfigRepository,
    private readonly promptSharedService: PromptSharedService,
  ) {}

  async resolve(options: ResolveLlmTargetOptions): Promise<ResolvedLlmTarget> {
    const tierModel = this.configService.llmTiers[options.tier];
    const taskRow = await this.taskRow(options.taskId);
    const promptRow = options.promptCode
      ? await this.promptRow(options.promptCode)
      : undefined;

    // Ordered highest priority first; the first layer naming a model wins.
    const layers: [LlmTargetSource, Selection | undefined][] = [
      [LlmTargetSource.REQUEST, options],
      [LlmTargetSource.PROMPT, promptRow],
      [LlmTargetSource.TASK, taskRow],
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
      // Temperature resolves independently: a layer may set a temperature
      // without setting a model (a prompt row tuning the task's own default),
      // and the providers already drop it for models that reject one.
      temperature: this.resolveTemperature(options, promptRow, taskRow),
      source,
      fallbackEnabled: taskRow?.fallbackEnabled ?? true,
      tierModel,
    };
  }

  private resolveTemperature(
    ...layers: (Selection | undefined)[]
  ): number | undefined {
    return layers.find((layer) => typeof layer?.temperature === 'number')
      ?.temperature;
  }

  private async taskRow(taskId: string): Promise<TaskRowSelection | undefined> {
    const now = Date.now();
    if (
      !this.cache ||
      now - this.cache.at > LlmTargetResolverService.CACHE_TTL_MS
    ) {
      try {
        const rows = await this.taskConfigRepository.findAllByTaskId();
        this.cache = {
          at: now,
          rows: new Map(
            [...rows].map(([id, row]) => [
              id,
              {
                provider: row.provider ?? undefined,
                model: row.model ?? undefined,
                temperature: row.temperature ?? undefined,
                fallbackEnabled: row.fallbackEnabled,
              },
            ]),
          ),
        };
      } catch (error) {
        // A resolver that throws when Postgres hiccups would take down every
        // LLM call with it, to protect config that is almost always absent.
        // Serving the tier default is the correct degradation.
        this.logger.warn(
          `[LLM-TARGET] Could not read llm_task_configs; using tier defaults. ${
            (error as Error)?.message ?? error
          }`,
        );
        return undefined;
      }
    }
    return this.cache.rows.get(taskId);
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
      this.logger.warn(
        `[LLM-TARGET] Could not read prompt config for "${promptCode}". ${
          (error as Error)?.message ?? error
        }`,
      );
      return undefined;
    }
  }

  /** Drops the cache so an admin's edit applies to the next call. */
  invalidate(): void {
    this.cache = undefined;
  }
}

interface Selection {
  provider?: string;
  model?: string;
  temperature?: number;
}

interface TaskRowSelection extends Selection {
  fallbackEnabled: boolean;
}
