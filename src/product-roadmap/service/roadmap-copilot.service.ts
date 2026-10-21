import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerService } from 'src/logger/logger.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from 'src/llm-agent/service/agent-llm.factory';
import {
  AgentContentBlock,
  AgentMessage,
  AgentSystemBlock,
  AgentTurnResult,
} from 'src/llm-agent/type/agent-llm.type';
import { IAgentLlmProvider } from 'src/llm-agent/provider/agent-llm-provider.interface';

import {
  ROADMAP_COPILOT,
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_LIMITS,
  ROADMAP_PROMPT_CODES,
  ROADMAP_READINESS_CRITERIA,
} from '../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../enum/roadmap-opportunity.enum';
import { OpportunityInterviewTurnResponseDto } from '../dto/roadmap-response.dto';
import { RoadmapOpportunityBrief } from '../type/roadmap-brief.type';
import { normaliseOpportunityBrief } from '../util/roadmap-brief.util';
import { RoadmapProductGoalRepository } from '../repository/roadmap-taxonomy.repository';
import { RoadmapStrategyGoalRepository } from '../repository/roadmap-strategy.repository';
import { RoadmapReadinessTokenService } from './roadmap-readiness-token.service';
import { RoadmapStrategyContextService } from './roadmap-strategy-context.service';
import { RoadmapOpportunityService } from './roadmap-opportunity.service';
import { BuilderProductMapService } from 'src/builder/service/builder-product-map.service';
import {
  COPILOT_SUBMIT_TOOL,
  RoadmapCopilotToolsService,
} from './roadmap-copilot-tools.service';

export interface CopilotTurnInput {
  messages: { role: 'admin' | 'agent'; content: string }[];
  /** The brief from the previous turn, echoed back unchanged. */
  brief?: unknown;
}

/** What the stream carries. `turn` or `error` is always the last frame. */
export type CopilotFrame =
  | { event: 'activity'; data: { id: string; label: string } }
  | {
      event: 'activity_done';
      data: { id: string; summary: string; ok: boolean };
    }
  | { event: 'turn'; data: OpportunityInterviewTurnResponseDto }
  | { event: 'error'; data: { message: string } };

/** What the model hands `submit_turn`, before any of it is trusted. */
interface SubmittedTurn {
  reply?: string;
  gates?: { id?: string; met?: boolean; note?: string }[];
  draft?: {
    description?: string;
    productGoal?: string | null;
    effort?: string | null;
  } | null;
  brief?: unknown;
}

type CopilotTarget = { provider: string; model: string };

const FAILED_TURN_MESSAGE =
  "I couldn't finish thinking that through. Your answer is still here — try sending it again.";

/**
 * The opportunity copilot: the guided interview that files every roadmap opportunity, given
 * the context to judge whether an idea is worth doing and not only whether it is clearly said.
 *
 * ## What changed from the single-shot interview
 *
 * The interview used to be one model call that saw the transcript, the five criteria and the
 * product-goal names — nothing else. It could make a draft CLEAR, but it could not tell the
 * admin that the same idea was already on the board, that analytics said four people a month
 * hit the screen in question, that it contradicted a stated non-goal, or that the code already
 * half-did it. This turns each turn into a short tool loop over that context, followed by one
 * structured answer.
 *
 * ## It advises; it does not block
 *
 * The filing gate is unchanged: the five readiness criteria, graded here and signed into the
 * token. Strategic fit and evidence are NOT gates. The copilot rates the case (needs work /
 * promising / strong) and keeps recommending how to strengthen it, and the admin can file the
 * moment the five are met. The rating and any unresolved recommendations are filed with the
 * opportunity, so voters see what the copilot thought rather than the filer being stopped.
 *
 * ## Still stateless
 *
 * The transcript and the working brief ride on every request, as before. What a turn's research
 * found survives into the next turn through the brief's evidence list, which is the one place
 * worth keeping it — so later turns re-read the brief rather than re-running the lookups.
 *
 * ## Structured output through a tool, not JSON mode
 *
 * The turn arrives as the input of `submit_turn`, which the prompt requires as the last call of
 * every turn. Not the adapters' `jsonMode`: on Anthropic that is a forced `tool_choice`, which
 * the current Claude models reject with a 400, and it cannot be combined with research tools
 * anyway. A pass that ends in prose instead gets one nudge, then a pass with `submit_turn` as
 * the only tool.
 */
@Injectable()
export class RoadmapCopilotService {
  private readonly logger = LoggerService.getInstance(
    RoadmapCopilotService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly llmUsage: LlmUsageService,
    private readonly agentLlmFactory: AgentLlmProviderFactory,
    private readonly tools: RoadmapCopilotToolsService,
    private readonly strategyContext: RoadmapStrategyContextService,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly productGoalRepository: RoadmapProductGoalRepository,
    private readonly strategyGoalRepository: RoadmapStrategyGoalRepository,
    private readonly readinessToken: RoadmapReadinessTokenService,
    private readonly productMap: BuilderProductMapService,
  ) {}

  /** One turn, collected — for the JSON endpoint the pre-streaming admin bundle still calls. */
  async takeTurn(
    input: CopilotTurnInput,
    userId: number,
  ): Promise<OpportunityInterviewTurnResponseDto> {
    for await (const frame of this.streamTurn(input, userId)) {
      if (frame.event === 'turn') return frame.data;
      if (frame.event === 'error') {
        throw new ServiceUnavailableException(frame.data.message);
      }
    }
    throw new ServiceUnavailableException(FAILED_TURN_MESSAGE);
  }

  /**
   * One turn as a stream: an `activity` / `activity_done` pair per lookup, so the admin can
   * watch it research rather than stare at a spinner, then exactly one `turn` or `error`.
   *
   * A turn whose model CALL fails — an outage, a rate limit, an exhausted credit balance — is
   * rerun once on the fallback model rather than failing. This is the only way to file an
   * opportunity, so a provider having a bad hour must not close the roadmap. Lookups the first
   * attempt already ran are reported again if the second repeats them; that is the honest trail.
   */
  async *streamTurn(
    input: CopilotTurnInput,
    userId: number,
  ): AsyncGenerator<CopilotFrame> {
    const turnId = randomUUID();
    let primary: CopilotTarget;
    let system: AgentSystemBlock[];
    let productGoalNames: string[];
    try {
      primary = await this.resolveModel();
      const prepared = await this.buildSystem(userId);
      system = prepared.system;
      productGoalNames = prepared.productGoalNames;
    } catch (error) {
      this.logger.error(
        `[ROADMAP] Copilot could not start a turn: ${(error as Error)?.message}`,
      );
      yield { event: 'error', data: { message: FAILED_TURN_MESSAGE } };
      return;
    }

    const loop = (target: CopilotTarget) =>
      this.runLoop(target, { input, userId, turnId, system, productGoalNames });

    let outcome = yield* loop(primary);
    const fallback = this.fallbackTarget(primary);
    if (outcome === 'provider_failed' && fallback) {
      this.logger.warn(
        `[ROADMAP] Copilot turn ${turnId}: ${primary.model} failed; retrying on ${fallback.model}.`,
      );
      outcome = yield* loop(fallback);
    }
    if (outcome !== 'done') {
      yield { event: 'error', data: { message: FAILED_TURN_MESSAGE } };
    }
  }

  /**
   * The tool loop on one model. Yields activity and, on success, the `turn`; returns how it
   * ended so `streamTurn` can decide whether a fallback is worth trying.
   */
  private async *runLoop(
    target: CopilotTarget,
    ctx: {
      input: CopilotTurnInput;
      userId: number;
      turnId: string;
      system: AgentSystemBlock[];
      productGoalNames: string[];
    },
  ): AsyncGenerator<CopilotFrame, 'done' | 'provider_failed' | 'no_submit'> {
    const { input, userId, turnId, system, productGoalNames } = ctx;
    let provider: IAgentLlmProvider;
    try {
      provider = this.agentLlmFactory.create(target.provider, target.model);
    } catch (error) {
      this.logger.error(
        `[ROADMAP] Copilot could not use ${target.model}: ${(error as Error)?.message}`,
      );
      return 'provider_failed';
    }

    const previousBrief = normaliseOpportunityBrief(input.brief);
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: this.renderUserTurn(input.messages, previousBrief),
      },
    ];
    const allTools = this.tools.getToolDefinitions();
    const submitOnly = allTools.filter((t) => t.name === COPILOT_SUBMIT_TOOL);

    let nudged = false;
    let forceSubmit = false;
    for (
      let iteration = 1;
      iteration <= ROADMAP_COPILOT.MAX_TOOL_ITERATIONS + 2;
      iteration += 1
    ) {
      // The last research pass and any pass after a nudge can only submit: the admin gets a
      // turn built from what was found so far rather than a loop that never answers.
      const finalPass =
        forceSubmit || iteration >= ROADMAP_COPILOT.MAX_TOOL_ITERATIONS;

      let turn: AgentTurnResult;
      try {
        turn = await this.runPass(provider, target, {
          system,
          messages,
          tools: finalPass ? submitOnly : allTools,
          iteration,
          turnId,
          userId,
        });
      } catch (error) {
        this.logger.error(
          `[ROADMAP] Copilot pass ${iteration} on ${target.model} failed: ${(error as Error)?.message}`,
        );
        return 'provider_failed';
      }

      if (turn.stopReason === 'invalid_tool_call' && !nudged) {
        // Transient on some providers; the same request usually succeeds. Counted as the nudge
        // so a provider that keeps doing it cannot loop us.
        nudged = true;
        continue;
      }

      // A pass cut off at max_tokens may end in a half-written tool call; its input is a
      // fragment, so nothing in it is run or trusted.
      const toolUses =
        turn.stopReason === 'max_tokens'
          ? []
          : turn.content.filter(
              (b): b is Extract<AgentContentBlock, { type: 'tool_use' }> =>
                b.type === 'tool_use',
            );
      const submit = toolUses.find((b) => b.name === COPILOT_SUBMIT_TOOL);
      if (submit) {
        const turnResult = this.buildTurn(
          submit.input as SubmittedTurn,
          productGoalNames,
          previousBrief,
        );
        // Before the admin has said anything there is no idea to assess, and a "Needs work"
        // verdict over an empty conversation reads as a judgement of the person, not the idea.
        const spoken = input.messages.some((m) => m.role === 'admin');
        yield {
          event: 'turn',
          data: spoken ? turnResult : { ...turnResult, brief: null },
        };
        return 'done';
      }

      if (!toolUses.length) {
        // Ended in prose (or was cut off). Nothing written outside submit_turn reaches the
        // admin, so ask for the call once, then leave it nothing else to do. The prose pass is
        // NOT appended: it may hold a half-written tool call with no result to pair it with,
        // which the API rejects, and history is only ever appended, never edited.
        if (forceSubmit) break;
        messages.push({
          role: 'user',
          content:
            'Call submit_turn now with your turn. The admin sees nothing you write outside it.',
        });
        nudged = true;
        forceSubmit = true;
        continue;
      }

      // Research. Run together and answered together in ONE user message — splitting the
      // results across messages teaches the model to stop making parallel calls.
      const started = toolUses.map((use) => ({
        use,
        id: randomUUID(),
        label: this.tools.describe(use.name, use.input),
      }));
      for (const { id, label } of started) {
        yield { event: 'activity', data: { id, label } };
      }
      const outcomes = await Promise.all(
        started.map(({ use }) =>
          this.tools.execute(use.name, use.input, { userId }),
        ),
      );
      for (const [index, { id }] of started.entries()) {
        yield {
          event: 'activity_done',
          data: {
            id,
            summary: outcomes[index].summary,
            ok: outcomes[index].ok,
          },
        };
      }

      messages.push({ role: 'assistant', content: turn.content });
      messages.push({
        role: 'user',
        content: started.map(({ use }, index) => ({
          type: 'tool_result' as const,
          tool_use_id: use.id,
          content: outcomes[index].modelResult,
        })),
      });
    }

    this.logger.warn(
      `[ROADMAP] Copilot turn ${turnId} on ${target.model} ended without submit_turn.`,
    );
    return 'no_submit';
  }

  /** The fallback model, when it is a different model and this environment can run it. */
  private fallbackTarget(primary: CopilotTarget): CopilotTarget | null {
    const model = this.configService.roadmapCopilot.fallbackModel;
    const provider = providerForModel(model);
    if (
      !provider ||
      model === primary.model ||
      !this.agentLlmFactory.isConfigured(provider)
    ) {
      return null;
    }
    return { provider, model };
  }

  /**
   * Prompt row first, then config; the provider follows from the model id when the row does
   * not name one. Falls back to the configured fallback model when the resolved provider has
   * no key here — local and preview environments often hold only an OpenAI key, and a copilot
   * that refuses to run is a roadmap nobody can file to.
   */
  private async resolveModel(): Promise<CopilotTarget> {
    const row = await this.promptSharedService.getPromptLlmConfig(
      ROADMAP_PROMPT_CODES.OPPORTUNITY_COPILOT,
    );
    const model = row.model?.trim() || this.configService.roadmapCopilot.model;
    const provider =
      normaliseAgentProvider(row.provider) ?? providerForModel(model);
    if (provider && this.agentLlmFactory.isConfigured(provider)) {
      return { provider, model };
    }

    const fallbackModel = this.configService.roadmapCopilot.fallbackModel;
    const fallbackProvider = providerForModel(fallbackModel);
    if (
      fallbackProvider &&
      this.agentLlmFactory.isConfigured(fallbackProvider)
    ) {
      this.logger.warn(
        `[ROADMAP] Copilot model ${model} (${provider ?? 'unknown provider'}) is not ` +
          `configured here; using ${fallbackModel}.`,
      );
      return { provider: fallbackProvider, model: fallbackModel };
    }
    throw new Error(
      `Neither the copilot model ${model} nor the fallback ${fallbackModel} has a provider ` +
        'key on this environment.',
    );
  }

  private async runPass(
    provider: IAgentLlmProvider,
    target: CopilotTarget,
    pass: {
      system: AgentSystemBlock[];
      messages: AgentMessage[];
      tools: ReturnType<RoadmapCopilotToolsService['getToolDefinitions']>;
      iteration: number;
      turnId: string;
      userId: number;
    },
  ): Promise<AgentTurnResult> {
    let turn: AgentTurnResult | null = null;
    for await (const event of provider.stream({
      model: target.model,
      maxTokens: ROADMAP_COPILOT.MAX_TOKENS,
      system: pass.system,
      messages: pass.messages,
      tools: pass.tools,
      timeoutMs: ROADMAP_COPILOT.PASS_TIMEOUT_MS,
    })) {
      if (event.type === 'final') turn = event.message;
    }
    if (!turn) {
      throw new Error(`${target.model} returned no response for this pass.`);
    }

    void this.llmUsage.record({
      provider: target.provider,
      model: target.model,
      task: LlmTask.ROADMAP_OPPORTUNITY_COPILOT,
      promptTokens: turn.usage.inputTokens,
      completionTokens: turn.usage.outputTokens,
      totalTokens: turn.usage.inputTokens + turn.usage.outputTokens,
      cachedTokens: turn.usage.cachedTokens,
      cacheCreationTokens: turn.usage.cacheCreationTokens,
      metadata: {
        feature: 'product-roadmap',
        turnId: pass.turnId,
        iteration: pass.iteration,
        userId: pass.userId,
      },
    });
    return turn;
  }

  /**
   * The system prompt, then everything the copilot always knows, as two cached blocks.
   *
   * First the product map — what Ally is as built: repos, admin surfaces, knowledge packs and
   * the documentation index. Then the Vision & strategy page, both goal lists, the readiness
   * criteria and the board as it stands. The map goes first because it changes least (it is
   * re-rendered at most every half hour; the board moves whenever someone files or votes), so
   * a board change re-pays only the second block. All of it is stable across the passes of a
   * turn and across the turns of a conversation, so a ten-turn interview pays full price once.
   */
  private async buildSystem(userId: number): Promise<{
    system: AgentSystemBlock[];
    productGoalNames: string[];
  }> {
    const [prompt, productMap, strategy, productGoals, strategyGoals, board] =
      await Promise.all([
        this.promptSharedService.getPromptByCode(
          ROADMAP_PROMPT_CODES.OPPORTUNITY_COPILOT,
        ),
        this.productMap.render(),
        this.strategyContext.renderForCopilot(),
        this.productGoalRepository.findAllOrdered(),
        this.strategyGoalRepository.findAllOrdered(),
        this.boardSnapshot(userId),
      ]);
    if (!prompt) {
      throw new Error(
        `Prompt template not found: ${ROADMAP_PROMPT_CODES.OPPORTUNITY_COPILOT}`,
      );
    }

    const productGoalNames = productGoals.map((g) => g.name);
    const context = [
      "# Ally's Vision & strategy page",
      strategy,
      '# Strategy goals — the outcomes the board is ranked against',
      strategyGoals.length
        ? strategyGoals.map((g) => `- ${g.name}`).join('\n')
        : '(none defined)',
      '# Product goals — filing categories; `draft.productGoal` must be exactly one of these, or null',
      productGoalNames.length
        ? productGoalNames.map((name) => `- ${name}`).join('\n')
        : '(none defined — use null)',
      '# Readiness criteria — the filing gate. Return a verdict for every id, in this order',
      ROADMAP_READINESS_CRITERIA.map(
        (c) => `- id: ${c.id}\n  criterion: ${c.label}\n  means: ${c.hint}`,
      ).join('\n'),
      `Fileable sizes: ${ROADMAP_FILEABLE_EFFORTS.join(', ')}. Size what was described, not a slice of it; a draft with no size cannot be filed.`,
      `# The board right now — the ${ROADMAP_COPILOT.BOARD_SNAPSHOT_ROWS} highest-ranked open opportunities`,
      board,
    ].join('\n\n');

    return {
      system: [
        { text: prompt },
        { text: productMap, cache: true },
        { text: context, cache: true },
      ],
      productGoalNames,
    };
  }

  /**
   * The top of the board, so the copilot knows what is already queued without spending a
   * lookup on it — and so "this is a smaller version of OPP-0714, which is third in the queue"
   * is something it can say on its first turn.
   */
  private async boardSnapshot(userId: number): Promise<string> {
    try {
      const { items } = await this.opportunityService.list(userId, {
        stage: ['new', 'prioritised', 'under_development'],
        limit: ROADMAP_COPILOT.BOARD_SNAPSHOT_ROWS,
      } as any);
      if (!items.length) return '(the board is empty)';
      return items
        .map(
          (o) =>
            `- ${o.code} [${o.stage} · ${o.productGoal} · ${o.effort ?? 'unsized'} · ${o.priorityScore} votes] ` +
            o.description.replace(/\s+/g, ' ').slice(0, 220),
        )
        .join('\n');
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Copilot board snapshot failed: ${(error as Error)?.message}`,
      );
      return '(unavailable this turn — use search_roadmap)';
    }
  }

  /**
   * The volatile half: the conversation, the brief so far, and today's date — after the cached
   * block, so none of it invalidates the prefix.
   *
   * Speaker-labelled transcript in one user message, as the single-shot interview did: without
   * labels the model re-asks its own questions.
   */
  private renderUserTurn(
    messages: CopilotTurnInput['messages'],
    brief: RoadmapOpportunityBrief | null,
  ): string {
    const transcript = messages.length
      ? messages
          .map(
            (m) =>
              `${m.role === 'admin' ? 'ADMIN' : 'YOU'}: ${m.content.trim()}`,
          )
          .join('\n\n')
      : '(nothing yet — this is the first turn, so open the conversation)';
    return [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      `Conversation so far:\n"""\n${transcript}\n"""`,
      `The brief as it stood after your last turn (keep what still holds, add what you learn):\n${
        brief
          ? JSON.stringify(brief, null, 2)
          : '(empty — nothing established yet)'
      }`,
      'Take your next turn now, and end it by calling submit_turn.',
    ].join('\n\n');
  }

  /**
   * The model's `submit_turn`, turned into something safe to show and to sign.
   *
   * THE GATES ARE THE FILING GATE'S OWN CRITERIA, graded `=== true` and failing closed: an
   * answer outside the schema reads as "not established yet", never as met. A draft exists
   * only when every gate is met, there is text, and the size is fileable — and only then is a
   * readiness token minted, over that exact description AND that exact brief, so what is filed
   * is what the copilot graded and what voters read as its assessment is its own.
   */
  buildTurn(
    submitted: SubmittedTurn | null | undefined,
    productGoalNames: string[],
    previousBrief: RoadmapOpportunityBrief | null,
  ): OpportunityInterviewTurnResponseDto {
    const byId = new Map(
      (Array.isArray(submitted?.gates) ? submitted!.gates : [])
        .filter((g) => typeof g?.id === 'string')
        .map((g) => [g.id as string, g]),
    );
    const gates = ROADMAP_READINESS_CRITERIA.map((criterion) => {
      const answer = byId.get(criterion.id);
      const met = answer?.met === true;
      return {
        id: criterion.id,
        met,
        note:
          (typeof answer?.note === 'string' && answer.note.trim()) ||
          (met ? 'Covered.' : 'Not covered yet.'),
      };
    });

    // A turn that wrote no brief keeps the last one: the evidence in it was paid for, and a
    // model that skipped the field this turn has not un-found it.
    const brief = normaliseOpportunityBrief(submitted?.brief) ?? previousBrief;

    const allMet = gates.every((g) => g.met);
    const description =
      typeof submitted?.draft?.description === 'string'
        ? submitted.draft.description.trim()
        : '';
    const effort = this.validEffort(submitted?.draft?.effort);
    // Every size files, but not NO size: "could not tell how big this is" means it is not yet
    // well defined enough to vote on, and there is no override to fall back on.
    const sizeFileable =
      effort !== null &&
      (ROADMAP_FILEABLE_EFFORTS as readonly string[]).includes(effort);

    const draft =
      allMet && description && sizeFileable
        ? {
            description: description.slice(0, ROADMAP_LIMITS.DESCRIPTION_MAX),
            productGoal: productGoalNames.includes(
              submitted?.draft?.productGoal as string,
            )
              ? (submitted!.draft!.productGoal as string)
              : null,
            effort,
          }
        : null;

    const withheldOnSize = allMet && !!description && !sizeFileable;
    if (withheldOnSize) {
      this.logger.warn(
        `[ROADMAP] Copilot drafted a ${effort ?? 'unsized'} opportunity. Withholding it and ` +
          'asking about scope rather than handing over a draft that cannot be filed.',
      );
    }

    const reply =
      typeof submitted?.reply === 'string' ? submitted.reply.trim() : '';

    return {
      reply: withheldOnSize
        ? "I can't put a size on this yet, so it isn't ready to file. What is in scope " +
          'for it, and what is deliberately left out?'
        : reply || 'Sorry — I lost that. Could you say it again?',
      gates,
      draft,
      brief,
      readinessToken: draft
        ? this.readinessToken.issue({
            description: draft.description,
            productGoal: draft.productGoal,
            failedCriteria: [],
            proposedEffort: draft.effort,
            brief,
          })
        : null,
    };
  }

  /** A model-proposed size, or null when it is not a live one. Never stored unvalidated. */
  private validEffort(
    proposed?: string | null,
  ): RoadmapOpportunityEffort | null {
    const value =
      typeof proposed === 'string' ? proposed.trim().toLowerCase() : '';
    return (Object.values(RoadmapOpportunityEffort) as string[]).includes(value)
      ? (value as RoadmapOpportunityEffort)
      : null;
  }
}
