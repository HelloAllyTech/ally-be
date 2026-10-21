import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { AgentLlmProviderFactory } from 'src/llm-agent/service/agent-llm.factory';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { LlmTargetResolverService } from 'src/llm/service/llm-target-resolver.service';
import { IAgentLlmProvider } from 'src/llm-agent/provider/agent-llm-provider.interface';
import { AgentTurnResult } from 'src/llm-agent/type/agent-llm.type';
import { BuilderSession } from '../../entity/builder-session.entity';
import { BuilderSessionStatus } from '../../enum/builder.enum';
import { BuilderPrdReadiness } from '../../type/builder-prd.type';
import {
  BuilderRepoMapRepository,
  BuilderLessonRepository,
} from '../../repository/builder-knowledge.repository';
import { BuilderPrdService } from '../../service/builder-prd.service';
import { BuilderKnowledgeService } from '../../service/builder-knowledge.service';
import { BuilderInterviewToolsService } from '../../service/builder-interview-tools.service';
import { BuilderInterviewOrchestratorService } from '../../service/builder-interview-orchestrator.service';
import { BuilderGithubReadService } from '../../service/builder-github-read.service';
import { BuilderStacksService } from '../../service/builder-stacks.service';
import { BuilderEvidenceService } from '../../service/builder-evidence.service';
import { BuilderCatalogService } from '../../service/builder-catalog.service';
import { BuilderEvidenceLogService } from '../../service/builder-evidence-log.service';
import { BuilderReadinessService } from '../../service/builder-readiness.service';
import { BuilderPrdReviewService } from '../../service/builder-prd-review.service';
import { BuilderPlatformContextService } from '../../service/builder-platform-context.service';
import { BuilderSettingsService } from '../../service/builder-settings.service';
import { BuilderSettings } from '../../entity/builder-settings.entity';
import { BuilderEvalOverrides } from '../type/builder-eval.type';
import { SandboxStores } from './builder-eval-stores';

/** One model pass the sandboxed interviewer made: what it returned, in order. */
export interface SandboxPass {
  content: any[];
  stopReason: string | null;
}

/** Everything one replay needs, built fresh for that replay. */
export interface BuilderEvalSandbox {
  session: BuilderSession;
  stores: SandboxStores;
  orchestrator: BuilderInterviewOrchestratorService;
  prdService: BuilderPrdService;
  readiness: BuilderReadinessService;
  /** One-shot calls for the simulated admin and the judge, billed to the run. */
  llmCompletion: LlmCompletionService;
  /** Every interviewer pass, for the batch-level gates. */
  passes: SandboxPass[];
  /** Estimated spend so far, all model calls in the replay. */
  costUsd: () => number;
  /** Which interview loop this replay runs. */
  validatedTurns: boolean;
  situationBrief: boolean;
}

/**
 * Builds a sandboxed Builder interview: the real orchestrator, tools,
 * readiness rubric and cold reviewer, wired to in-memory stores instead of
 * the builder tables.
 *
 * What is real, and why: the model calls (that is what is being tested), the
 * repo knowledge packs, lessons, catalog and platform map (read-only, and the
 * interview's context), and the research tools — GitHub reads, docs search,
 * Stacks, production analytics — which only read. File reads are pinned to the
 * fixture's commits when it has them.
 *
 * What is swapped:
 * - the stores, so nothing is written to a builder table;
 * - prompt text and model settings, from the run's overrides — the way a
 *   candidate prompt edit is tried before it goes live. Read through a facade
 *   in front of PromptSharedService, so nothing live ever sees them;
 * - usage, re-labelled BUILDER_EVAL so the replay's spend is not reported as
 *   real interviews, and summed into the run's cost;
 * - exemplar selection, which is off: it writes to the session row and is a
 *   ranking call the replay does not need to repeat;
 * - the validated-turns switch, from the run's overrides. Every suite stamps
 *   it when it starts; one with no stamp was started before the switch
 *   existed and replays the legacy loop it began on — never the live
 *   setting, or a suite resumed across the deploy that added the switch
 *   would change loops halfway through and measure neither.
 */
@Injectable()
export class BuilderEvalSandboxFactory {
  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
    private readonly agentLlmFactory: AgentLlmProviderFactory,
    private readonly resolver: LlmTargetResolverService,
    private readonly repoMapRepository: BuilderRepoMapRepository,
    private readonly lessonRepository: BuilderLessonRepository,
    private readonly githubRead: BuilderGithubReadService,
    private readonly stacks: BuilderStacksService,
    private readonly evidence: BuilderEvidenceService,
    private readonly catalog: BuilderCatalogService,
    private readonly platformContext: BuilderPlatformContextService,
  ) {}

  create(options: {
    evalRunId: string;
    title: string;
    userId: number;
    handoffContext?: string | null;
    overrides?: BuilderEvalOverrides | null;
    pins?: Record<string, string>;
  }): BuilderEvalSandbox {
    const stores = new SandboxStores();
    const passes: SandboxPass[] = [];
    let cost = 0;

    const session = {
      id: uuidv4(),
      title: options.title,
      slug: `eval-${options.evalRunId.slice(0, 8)}`,
      status: BuilderSessionStatus.INTERVIEWING,
      repos: null,
      lastMessageSeq: 0,
      metadata: {},
      contextExemplarIds: [],
      createdBy: options.userId,
    } as unknown as BuilderSession;

    const overrides = options.overrides ?? {};
    const validatedTurns = overrides.validatedTurns === true;
    const situationBrief = overrides.situationBrief === true;
    const realPrompts = this.promptSharedService;
    const prompts = new Proxy(realPrompts, {
      get(target, property, receiver) {
        if (property === 'getPromptByCode') {
          return async (code: string, ...rest: unknown[]) => {
            const candidate = overrides.prompts?.[code];
            return typeof candidate === 'string'
              ? candidate
              : (target.getPromptByCode as any)(code, ...rest);
          };
        }
        if (property === 'getPromptLlmConfig') {
          return async (code: string) => {
            const live = await target.getPromptLlmConfig(code);
            const candidate = overrides.llmConfig?.[code];
            if (!candidate) return live;
            const pick = <T>(
              next: T | null | undefined,
              current: T | undefined,
            ) => (next === undefined ? current : (next ?? undefined));
            return {
              provider: pick(candidate.provider, live.provider),
              model: pick(candidate.model, live.model),
              temperature: pick(candidate.temperature, live.temperature),
            };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as PromptSharedService;

    const realUsage = this.llmUsage;
    const usage = {
      record: (params: Parameters<LlmUsageService['record']>[0]) => {
        cost += computeCostUsd(
          params.model ?? '',
          params.promptTokens ?? 0,
          params.completionTokens ?? 0,
          {
            cacheReadTokens: params.cachedTokens ?? 0,
            cacheCreationTokens: params.cacheCreationTokens ?? 0,
          },
        ).costUsd;
        return realUsage.record({
          ...params,
          task: LlmTask.BUILDER_EVAL,
          metadata: {
            ...(params.metadata ?? {}),
            evalRunId: options.evalRunId,
            evalOf: String(params.task ?? ''),
          },
        });
      },
    } as unknown as LlmUsageService;

    const realFactory = this.agentLlmFactory;
    const capturingFactory = new Proxy(realFactory, {
      get(target, property, receiver) {
        if (property === 'create') {
          return (provider: string, model: string): IAgentLlmProvider => {
            const inner = target.create(provider, model);
            return {
              name: inner.name,
              stream: async function* (request) {
                for await (const event of inner.stream(request)) {
                  if (event.type === 'final') {
                    const message = event.message as AgentTurnResult;
                    passes.push({
                      content: JSON.parse(
                        JSON.stringify(message.content ?? []),
                      ),
                      stopReason: message.stopReason ?? null,
                    });
                  }
                  yield event;
                }
              },
            };
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as AgentLlmProviderFactory;

    const pins = options.pins ?? {};
    const github = new Proxy(this.githubRead, {
      get(target, property, receiver) {
        if (property === 'readFile' || property === 'repoTree') {
          return (repo: string, path?: string, ref?: string) =>
            (target as any)[property](repo, path, ref ?? pins[repo]);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as BuilderGithubReadService;

    const llmCompletion = new LlmCompletionService(
      this.resolver,
      realFactory,
      usage,
    );
    const prdService = new BuilderPrdService(
      stores.docRepository as any,
      stores.dataSource as any,
    );
    const knowledgeService = new BuilderKnowledgeService(
      this.repoMapRepository,
      this.lessonRepository,
      prompts,
    );
    const evidenceLog = new BuilderEvidenceLogService(
      stores.evidenceRepository as any,
    );
    const reviewService = new BuilderPrdReviewService(
      llmCompletion,
      stores.docRepository as any,
      stores.messageRepository as any,
      evidenceLog,
      this.catalog,
    );
    const readiness = new BuilderReadinessService(
      prdService,
      this.catalog,
      evidenceLog,
      stores.messageRepository as any,
      stores.versionRepository as any,
      reviewService,
    );
    const tools = new BuilderInterviewToolsService(
      prdService,
      github,
      this.stacks,
      this.evidence,
      this.catalog,
      evidenceLog,
      readiness,
      reviewService,
      stores.messageRepository as any,
    );

    // The two session-service calls the turn makes, with the real status rule:
    // only INTERVIEWING ⇄ PRD_READY moves, and only with readiness.
    const sessionService = {
      getSession: async () => session,
      getHandoffContext: async () => options.handoffContext ?? null,
      syncReadinessStatus: async (
        target: BuilderSession,
        readinessNow: BuilderPrdReadiness,
      ) => {
        if (
          target.status === BuilderSessionStatus.INTERVIEWING ||
          target.status === BuilderSessionStatus.PRD_READY
        ) {
          target.status = readinessNow.ready
            ? BuilderSessionStatus.PRD_READY
            : BuilderSessionStatus.INTERVIEWING;
        }
        return target.status;
      },
    };

    const orchestrator = new BuilderInterviewOrchestratorService(
      this.configService,
      prompts,
      sessionService as any,
      prdService,
      knowledgeService,
      tools,
      stores.messageRepository as any,
      usage,
      {
        digestsForSession: async () => ({ digests: [], chosen: null }),
      } as any,
      stores.sessionRepository as any,
      capturingFactory,
      llmCompletion,
      readiness,
      this.platformContext,
      {
        get: async () =>
          ({ validatedTurns, situationBrief }) as BuilderSettings,
      } as BuilderSettingsService,
    );

    return {
      session,
      stores,
      orchestrator,
      prdService,
      readiness,
      llmCompletion,
      passes,
      costUsd: () => cost,
      validatedTurns,
      situationBrief,
    };
  }
}
