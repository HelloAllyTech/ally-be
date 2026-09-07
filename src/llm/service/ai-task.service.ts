import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import {
  AI_TASK_REGISTRY,
  AiTaskEntry,
} from '../constants/ai-task-registry.constants';
import { AiTaskResponseDto, AiTaskModelSource } from '../dto/ai-task.dto';
import { LlmTargetResolverService } from './llm-target-resolver.service';

/**
 * Serves the AI task registry, with this deployment's real model values
 * overlaid where they are knowable.
 *
 * The overlay is the reason this is a service and not a bare constant export.
 * A registry that only ever showed the literals committed to the repo would be
 * a document in a table's clothing: an environment that sets
 * ANTHROPIC_AUTOFILL_MODEL would still read the old id here and nobody would
 * find out until they compared a bill against it. So every row that ally-be
 * itself executes carries a `configPath`, and its effective model is read from
 * ConfigService at request time.
 *
 * The overlay stops at the process boundary, deliberately. ally-ai and
 * ally-ai-learn read their own env in their own containers; ally-be cannot see
 * it and must not pretend to. Those rows are returned as DOCUMENTED, and the
 * admin screen labels them so, which is a smaller lie than a confident wrong
 * number.
 */
@Injectable()
export class AiTaskService {
  private readonly logger = new Logger(AiTaskService.name);

  constructor(
    private readonly configService: AppConfigService,
    private readonly resolver: LlmTargetResolverService,
  ) {}

  /**
   * The whole registry, newest resolution applied. Small (tens of rows) and
   * derived from constants, so it is computed per request rather than cached —
   * there is nothing to invalidate and nothing to gain.
   */
  async getTasks(): Promise<AiTaskResponseDto[]> {
    // One table read for the whole screen rather than one per row: the resolver
    // caches it, and 71 sequential lookups on an admin page would be the same
    // query 71 times.
    return Promise.all(AI_TASK_REGISTRY.map((entry) => this.toDto(entry)));
  }

  private async toDto(entry: AiTaskEntry): Promise<AiTaskResponseDto> {
    // What the config path says, if the row has one. For a tiered row this is
    // absent by construction (the id guard asserts it), and for the rest it is
    // the default the call site reads.
    const configured = entry.configPath
      ? this.resolveConfiguredModel(entry.configPath)
      : undefined;

    // A row resolves through the same chain its call site uses whenever this
    // process can know the answer — so the screen reports what will ACTUALLY
    // serve the task rather than a default something may already have
    // overridden. Two shapes qualify:
    //
    //  * a tiered row, whose floor is the platform tier
    //  * a row with its own config default AND a prompt override, whose floor
    //    is that config value — the character interview, which reads
    //    `characterInterview.model` but lets its prompt row win first
    //
    // Before this, such a row had to pick one truth: resolve the prompt row and
    // go blind to the env var, or read the env var and go blind to the
    // override. It showed gpt-5-mini while the interview actually ran the
    // Gemini model its prompt row names.
    const chain =
      entry.tier || (configured && entry.promptOverride)
        ? await this.resolveThroughChain(entry, configured)
        : undefined;
    const resolved = chain ?? configured;

    return {
      id: entry.id,
      task: entry.task,
      runtime: entry.runtime,
      trigger: entry.trigger,
      detail: entry.detail ?? null,
      hotPath: entry.hotPath ?? false,
      kind: entry.kind,
      provider: entry.provider,
      defaultModel: entry.defaultModel,
      effectiveModel: resolved ?? entry.defaultModel,
      modelSource: resolved
        ? AiTaskModelSource.DEPLOYMENT
        : AiTaskModelSource.DOCUMENTED,
      configuredBy: entry.configuredBy,
      promptOverride: entry.promptOverride ?? null,
    };
  }

  /**
   * Ask the resolver what will serve this task, and translate the rung it
   * answered from into the screen's vocabulary.
   *
   * Resolution can throw — an unusable provider, a model nothing claims — and a
   * single bad row must not blank the whole screen. On failure the row falls
   * back to its documented default, which is the same trade-off
   * `resolveConfiguredModel` already makes for a stale config path.
   */
  private async resolveThroughChain(
    entry: AiTaskEntry,
    fallbackModel?: string,
  ): Promise<string | undefined> {
    try {
      const target = await this.resolver.resolve({
        taskId: entry.id,
        ...(entry.tier ? { tier: entry.tier } : {}),
        ...(fallbackModel ? { fallbackModel } : {}),
        promptCode: entry.promptOverride ?? undefined,
        neverFallback: entry.neverFallback,
      });
      return target.model;
    } catch (error) {
      this.logger.warn(
        `[AI-TASKS] Could not resolve "${entry.id}"; showing its documented ` +
          `default. ${(error as Error)?.message ?? error}`,
      );
      return undefined;
    }
  }

  /**
   * Read a `getter.property` path off ConfigService.
   *
   * Only two segments are supported because that is the shape every config
   * getter has, and a general path walker would invite someone to point a
   * registry row at something that is not a model id. A path that resolves to
   * nothing is logged once and falls back to the documented default: a stale
   * path should degrade the table's precision, never fail the request. The
   * service spec asserts every path in the registry resolves, so a rename is
   * caught in CI rather than by this warning in production.
   */
  private resolveConfiguredModel(path: string): string | undefined {
    const [getter, property] = path.split('.');
    if (!getter || !property) {
      this.logger.warn(`[AI-TASKS] Malformed configPath "${path}"`);
      return undefined;
    }

    const section = (this.configService as unknown as Record<string, unknown>)[
      getter
    ];
    if (!section || typeof section !== 'object') {
      this.logger.warn(
        `[AI-TASKS] configPath "${path}" has no getter "${getter}"`,
      );
      return undefined;
    }

    const value = (section as Record<string, unknown>)[property];
    if (typeof value !== 'string' || !value.trim()) return undefined;
    return value;
  }
}
