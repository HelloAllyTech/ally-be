import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from 'src/llm-agent/service/agent-llm.factory';
import { IAgentLlmProvider } from 'src/llm-agent/provider/agent-llm-provider.interface';
import {
  AgentStreamRequest,
  AgentSystemBlock,
  AgentTurnResult,
  AgentUsage,
} from 'src/llm-agent/type/agent-llm.type';
import {
  AgentProviderFailure,
  classifyAgentProviderError,
  describeAgentProviderError,
} from 'src/llm-agent/util/agent-provider-error.util';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmCompletionService } from 'src/llm-agent/service/llm-completion.service';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderMessageRole } from '../enum/builder.enum';
import { BuilderSessionService } from './builder-session.service';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import { BuilderPlatformContextService } from './builder-platform-context.service';
import { BuilderReadinessService } from './builder-readiness.service';
import {
  BuilderInterviewToolsService,
  BuilderToolExecutionContext,
} from './builder-interview-tools.service';
import {
  BuilderSseFrame,
  BuilderToolExecutionOutcome,
  BuilderTurnReceipt,
} from '../type/builder-sse.type';
import { BuilderSettingsService } from './builder-settings.service';
import { freeTextOf } from './builder-readiness.service';
import { isAcknowledgement } from '../util/builder-readiness-checks.util';
import {
  claimsPrdEdit,
  claimsPrdReady,
} from '../util/builder-turn-claims.util';
import {
  BUILDER_PRD_EDIT_TOOLS,
  BUILDER_TERMINAL_TOOLS,
  buildTurnReceipt,
  describeToolAttempt,
  describeToolFailure,
  isResearchTool,
  joinCallsToResults,
  receiptIsEmpty,
  receiptOfStoredTurn,
  renderReceiptLine,
} from '../util/builder-turn-receipt.util';
import {
  BUILDER_INTERVIEW_PROTOCOL,
  BUILDER_TURN_PROTOCOL,
} from '../constants/builder-validated-tools.constants';
import {
  BuilderDiscovery,
  foundLines,
  planDiscovery,
  renderDiscoveryBlock,
  runDiscovery,
} from '../util/builder-discovery.util';
import {
  BuilderBriefResponse,
  BuilderSituationBrief,
  normaliseBriefResponse,
  normaliseSituationBrief,
  renderBriefForModel,
  renderBriefResponse,
  storedSituationBrief,
} from '../util/builder-situation-brief.util';
import { questionGateProblems } from '../util/builder-question-gate.util';
import { CreateBuilderMessageDto } from '../dto/builder.dto';
import { BuilderPrdReadiness } from '../type/builder-prd.type';
import {
  BUILDER_INTERVIEW_MAX_TOKENS,
  BUILDER_SYSTEM_PROMPT_TTL_MS,
  BUILDER_INTERVIEW_SUMMARY_AFTER_MESSAGES,
  BUILDER_INTERVIEW_SUMMARY_KEEP_RECENT,
  BUILDER_MAX_TRUNCATION_RETRIES,
  BUILDER_PROMPTS,
  BUILDER_AI_TASKS,
} from '../constants/builder.constants';

/**
 * What the model is told when its own message was cut off at the output cap.
 *
 * It is phrased as a fact plus an instruction because the model cannot see
 * the truncation from its side: the transcript it gets back looks like a
 * message it chose to end, and without this it re-sends the same oversized
 * patch and is cut off again.
 */
const BUILDER_TRUNCATION_NUDGE =
  'Your previous message hit the output limit and was cut off before it ' +
  'finished. Nothing from it was saved — any tool call it contained was ' +
  'discarded, so the PRD is unchanged. Write it again as several smaller ' +
  'update_prd calls, one section per call (requirements, then technicalPlan, ' +
  'then testPlanMd), rather than one large patch.';

/** Shown to the admin when a turn came back with nothing in it at all. */
const BUILDER_EMPTY_TURN_ERROR =
  'That turn came back empty — nothing was written and nothing was asked. ' +
  'Send your message again.';

/**
 * Shown to the admin when the model kept producing unreadable tool calls.
 *
 * Deliberately says the model rather than the request: the admin's message was
 * fine, and a turn that reads as their fault invites them to rewrite something
 * that was never the problem.
 */
const BUILDER_INVALID_TOOL_CALL_ERROR =
  'The model garbled its own tool call several times in a row, so that turn ' +
  'did nothing and the PRD is unchanged. Send your message again — this ' +
  'usually clears on its own.';

/**
 * What the admin is told when the provider call itself failed.
 *
 * One line per cause, because the actions differ: a quota needs an
 * administrator, a rate limit needs a minute, and an oversized request needs
 * the admin to do something smaller. Relaying the provider's own message
 * instead tells them about an API they have no access to.
 */
const BUILDER_PROVIDER_ERRORS: Record<AgentProviderFailure, string> = {
  [AgentProviderFailure.QUOTA]:
    'The account behind the interview model is out of credit, so the turn ' +
    'could not run. Your answers are all still here. An administrator needs ' +
    'to top it up.',
  [AgentProviderFailure.AUTH]:
    "The interview model rejected this environment's credentials, so the " +
    'turn could not run. Your answers are all still here. An administrator ' +
    'needs to check the API key.',
  [AgentProviderFailure.RATE_LIMIT]:
    'The interview model is rate-limiting us right now. Nothing was lost — ' +
    'send your message again in a minute.',
  [AgentProviderFailure.UNAVAILABLE]:
    'The interview model is unavailable at the moment. Nothing was lost — ' +
    'send your message again shortly.',
  [AgentProviderFailure.REQUEST_TOO_LARGE]:
    'This interview has grown past what the model will accept in one ' +
    'request. Nothing was lost. Writing the finished sections into the PRD ' +
    'and starting a fresh session for what is left is the way out.',
  [AgentProviderFailure.UNKNOWN]:
    'That turn failed before anything was saved, so the PRD is unchanged. ' +
    'Send your message again.',
};

/** SSE error codes, so a client can branch without parsing the copy above. */
const BUILDER_PROVIDER_ERROR_CODES: Record<AgentProviderFailure, string> = {
  [AgentProviderFailure.QUOTA]: 'provider_quota_exhausted',
  [AgentProviderFailure.AUTH]: 'provider_auth_failed',
  [AgentProviderFailure.RATE_LIMIT]: 'provider_rate_limited',
  [AgentProviderFailure.UNAVAILABLE]: 'provider_unavailable',
  [AgentProviderFailure.REQUEST_TOO_LARGE]: 'request_too_large',
  [AgentProviderFailure.UNKNOWN]: 'interview_error',
};

/**
 * A validated turn that did work but never sent a reply. Not "came back
 * empty": its receipt lists what it read and changed, and saying nothing was
 * written would contradict the line under it.
 */
const BUILDER_NO_REPLY_ERROR =
  'That turn ended without a reply. What it read and changed is listed under ' +
  'this message — send your message again to carry on.';

/**
 * Times a validated turn's reply is sent back before the next one goes out
 * regardless, with what it still gets wrong on the receipt. Two: one problem
 * per attempt is the common case, and a third attempt costs the admin more
 * waiting than a reply with a warning under it.
 */
const BUILDER_MAX_TURN_REJECTIONS = 2;

/** A validated pass that ended in prose instead of a turn-ending call. */
const BUILDER_END_TURN_NUDGE =
  'The admin has not seen that — only the `message` of `ask_admin` or `finish_turn` ' +
  'reaches them. Finish what the turn needs (edits included), then end it with one of those.';

/** The second time: from here only the turn-ending tools are offered. */
const BUILDER_END_TURN_NUDGE_FINAL =
  'End the turn now with `ask_admin` or `finish_turn`; nothing else will run this turn.';

/** On the receipt when the reply had to be the model's own notes. */
const BUILDER_PROSE_FALLBACK_WARNING =
  "Builder didn't end the turn with a reply, so its working notes are shown instead.";

/** Room the summarised turns' receipts get in the replayed history. */
const BUILDER_EARLIER_RECEIPTS_MAX_CHARS = 6_000;

/** Shown to the admin when a turn overruns the cap past recovering. */
const BUILDER_TRUNCATION_ERROR =
  "That turn ran past the response limit before anything was saved, so the PRD hasn't " +
  'changed. Ask for one section at a time — "write the requirements only" — and it will fit.';

/** Everything one turn accumulates, shared by both loops and the checkpoint. */
interface InterviewTurnState {
  /** Legacy loop: the prose the admin watched stream in. */
  textParts: string[];
  /** Validated loop: what the model wrote outside the reply. Never shown. */
  workingNotes: string[];
  /** Validated loop: the reply the admin was shown. */
  reply: string | null;
  allToolCalls: Record<string, any>[];
  allToolResults: Record<string, any>[];
  questions: Record<string, any>[];
  iterations: number;
  stopReason: string | null;
  errored: boolean;
  error: string | null;
  truncations: number;
  invalidToolCalls: number;
  emptyPasses: number;
  /** Replies sent back to the model this turn. */
  rejections: number;
  /** Problems already held against a reply once; raised again, they only warn. */
  raised: Set<string>;
  /** What the reply was delivered with anyway, for the receipt. */
  warnings: string[];
  prdUnchangedBecause: string | null;
  receipt: BuilderTurnReceipt | null;
  /** The discovery sweep this turn ran, if it ran one. */
  discovery: BuilderDiscovery | null;
  /** What the sweep's calls returned, for the receipt; never persisted. */
  discoveryCalls: {
    name: string;
    input: Record<string, any>;
    result: Record<string, any>;
  }[];
  /** A brief the reply carries, checked and waiting to be shown. */
  pendingBrief: BuilderSituationBrief | null;
  /** The brief this turn showed. */
  situationBrief: BuilderSituationBrief | null;
}

function createTurnState(): InterviewTurnState {
  return {
    textParts: [],
    workingNotes: [],
    reply: null,
    allToolCalls: [],
    allToolResults: [],
    questions: [],
    iterations: 0,
    stopReason: null,
    errored: false,
    error: null,
    truncations: 0,
    invalidToolCalls: 0,
    emptyPasses: 0,
    rejections: 0,
    raised: new Set(),
    warnings: [],
    prdUnchangedBecause: null,
    receipt: null,
    discovery: null,
    discoveryCalls: [],
    pendingBrief: null,
    situationBrief: null,
  };
}

/** What both loops run with; fixed for the turn. */
interface InterviewLoopContext {
  sessionId: string;
  provider: IAgentLlmProvider;
  model: string;
  providerName: string;
  system: AgentSystemBlock[];
  messages: any[];
  tools: any[];
  context: BuilderToolExecutionContext;
  maxIterations: number;
  /** PRD version when the turn started — "did the PRD change" is this moving. */
  versionBefore: number;
  /** The admin's own words this turn, when there are some to apply. */
  adminFreeText: string | null;
  checkpoint: (final: boolean) => Promise<void>;
  /** The interview protocol (builder_settings.situationBrief) is on this turn. */
  protocol: boolean;
  /** This turn's reply is the situation brief. */
  briefDue: boolean;
}

/** A reason a validated reply is not shown yet, phrased for each reader. */
interface ReplyProblem {
  /** Stable for the turn, so a problem holds a reply back only once. */
  key: string;
  toModel: string;
  toAdmin: string;
}

const clipText = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The PRD-interview turn loop: stream an Anthropic response, execute tool
 * calls, feed results back, repeat — capped at
 * config.builder.maxToolIterations round-trips per turn.
 *
 * ## Why the request is assembled in three pieces
 *
 * The system prompt and the Ally context block (repo maps, feature registry,
 * lessons) are large and identical across every turn of a session, while the
 * PRD draft and the transcript change constantly. Splitting them and marking
 * the stable pair `cache_control: ephemeral` means a twenty-turn interview
 * pays full input price for the heavy context once and cache-read prices
 * thereafter. Put the volatile PRD in the cached prefix and the cache misses
 * on every turn — the ordering here is load-bearing, not cosmetic.
 */
@Injectable()
export class BuilderInterviewOrchestratorService {
  /**
   * Per instance, deliberately. The live service is a singleton, so this is
   * one cache in practice — but the replay eval builds its own orchestrator
   * around a candidate prompt, and a static cache would hand that candidate
   * to every live interview for the next minute (or a live prompt to the
   * candidate's replay, which would then test the wrong thing).
   */
  private systemPromptCache: { text: string; expiresAt: number } | null = null;

  private readonly logger = LoggerService.getInstance(
    BuilderInterviewOrchestratorService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly sessionService: BuilderSessionService,
    private readonly prdService: BuilderPrdService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly toolsService: BuilderInterviewToolsService,
    private readonly messageRepository: BuilderMessageRepository,
    private readonly llmUsage: LlmUsageService,
    private readonly exemplarService: BuilderExemplarService,
    private readonly sessionRepository: BuilderSessionRepository,
    private readonly agentLlmFactory: AgentLlmProviderFactory,
    private readonly llmCompletion: LlmCompletionService,
    private readonly readiness: BuilderReadinessService,
    /** The platform map block. Optional so a fixture without one still runs a turn. */
    @Optional()
    private readonly platformContext?: BuilderPlatformContextService,
    /**
     * The validated-turns switch. Optional so a fixture without it runs
     * validated. Typed as the class, not a Pick of it: the parameter type is
     * the injection token, and a structural type would emit `Object`, which
     * @Optional() would quietly resolve to nothing.
     */
    @Optional()
    private readonly settingsService?: BuilderSettingsService,
  ) {}

  /**
   * Which model runs this turn, and who provides it.
   *
   * The interviewer prompt row wins, the same knob character-interview uses:
   * a model change and the prompt retuning it usually needs are one edit in
   * one place. `builder.interviewModel` is the fallback, and the provider is
   * inferred from the model id when nothing states it — so setting a model is
   * normally the whole change.
   *
   * Resolution failure is environment-level rather than turn-level: the next
   * turn and the one after fail identically, so the caller leaves the
   * transcript untouched rather than stacking errored rows into it.
   */
  private async resolveModel(): Promise<{ provider: string; model: string }> {
    let promptProvider: string | undefined;
    let promptModel: string | undefined;
    try {
      const promptConfig = await this.promptSharedService.getPromptLlmConfig(
        BUILDER_PROMPTS.INTERVIEWER_SYSTEM,
      );
      promptProvider = promptConfig.provider;
      promptModel = promptConfig.model;
    } catch (error) {
      this.logger.warn(
        `Builder interviewer prompt LLM config unavailable, using config: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (promptModel) {
      const resolved =
        normaliseAgentProvider(promptProvider) ?? providerForModel(promptModel);
      if (resolved) {
        return { provider: resolved, model: promptModel };
      }
      this.logger.warn(
        `Builder interviewer prompt names model "${promptModel}" with no ` +
          'provider this service can run; falling back to config.',
      );
    } else if (promptProvider) {
      // A provider with no model is half a setting: it cannot be combined with
      // the configured model, which may belong to a different provider.
      this.logger.warn(
        `Builder interviewer prompt sets provider "${promptProvider}" but no ` +
          'model; falling back to config.',
      );
    }

    const model = this.configService.builder.interviewModel;
    const resolved = providerForModel(model);
    if (!resolved) {
      throw new Error(
        `No provider is known for Builder interview model "${model}". Pick ` +
          'the provider on the interviewer prompt, or set ' +
          'BUILDER_INTERVIEW_MODEL to a model whose id names one.',
      );
    }
    return { provider: resolved, model };
  }

  /**
   * One provider round-trip. Relays text deltas as `token` frames when asked
   * to — the legacy loop shows prose as it streams; a validated turn shows
   * nothing until its reply has been checked — and returns the accumulated
   * turn.
   */
  private async *runPass(
    provider: IAgentLlmProvider,
    request: AgentStreamRequest,
    relayText = true,
  ): AsyncGenerator<BuilderSseFrame, AgentTurnResult> {
    let result: AgentTurnResult | null = null;
    for await (const event of provider.stream(request)) {
      if (event.type === 'text_delta') {
        if (relayText) {
          yield { event: 'token', data: { delta: event.text } };
        }
      } else {
        result = event.message;
      }
    }
    if (!result) {
      // Every adapter ends with a `final`; one that did not would otherwise
      // read as a normal empty turn and be persisted as one.
      throw new Error(
        `The ${provider.name} model returned no response for this turn.`,
      );
    }
    return result;
  }

  /**
   * One streamed interview turn. Persists the admin's message up front, then
   * allocates the assistant row and checkpoints it after every model pass and
   * every tool, so an interrupted turn keeps whatever it had already done.
   * Yields SSE frames throughout.
   *
   * Which loop runs is `builder_settings.validatedTurns`: the validated loop
   * (the reply reaches the admin only once it is true) or the loop the
   * interview ran before it. Either way the turn ends with a receipt of what
   * it read, changed and what failed.
   */
  async *streamTurn(
    sessionId: string,
    dto: CreateBuilderMessageDto,
    userId: number,
  ): AsyncGenerator<BuilderSseFrame> {
    const session = await this.sessionService.getSession(sessionId);
    const doc = await this.prdService.getOrCreateDoc(
      sessionId,
      userId,
      session.title,
    );
    const maxIterations = Math.max(
      1,
      Number(this.configService.builder.maxToolIterations) || 16,
    );

    // Resolved before anything is written.
    //
    // A misconfigured model is not a turn-level failure: the next turn fails
    // identically, so persisting the admin's message plus an errored assistant
    // row would stack the same pair into the transcript until someone fixes
    // the config. Leaving it untouched means the interview is exactly where
    // they left it once it is.
    let provider: IAgentLlmProvider;
    let model: string;
    let providerName: string;
    try {
      const resolved = await this.resolveModel();
      providerName = resolved.provider;
      model = resolved.model;
      provider = this.agentLlmFactory.create(resolved.provider, resolved.model);
      // The one line that says what actually ran.
      //
      // Everything else here logs on failure, which was fine while there was
      // one possible answer and is not now: a turn that succeeds says nothing,
      // so "which model served this interview?" was unanswerable from the logs
      // even though the whole point of this path is that it varies. Info
      // rather than debug — one line per turn is cheap, and this is the line
      // anyone debugging a turn wants first.
      this.logger.info(
        `[BUILDER_INTERVIEW] session=${sessionId} ${providerName}/${model}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Builder session ${sessionId} cannot start a turn: ${detail}`,
      );
      yield {
        event: 'error',
        data: { code: 'interview_misconfigured', message: detail },
      };
      yield { event: 'done', data: {} };
      return;
    }

    // A row left `streaming` belongs to a turn that died without finishing —
    // settle it before this turn writes beside it, so the transcript never
    // shows two open assistant messages.
    const closed =
      await this.messageRepository.closeInterruptedMessages(sessionId);
    if (closed) {
      this.logger.warn(
        `Builder session ${sessionId}: closed ${closed} interrupted assistant message(s).`,
      );
    }

    const history = await this.messageRepository.listBySession(sessionId);
    const validatedTurns = await this.validatedTurnsEnabled();
    // The interview protocol rides on validated turns: its brief and its
    // question gate are checked the way a validated reply is.
    const protocol = validatedTurns && (await this.situationBriefEnabled());
    const briefDue = protocol && this.isBriefDue(history);

    // An answer to the situation brief is rendered here, from the verdicts,
    // so the model, the transcript and the learning loop read the same words.
    const briefAnswered = dto.briefResponse
      ? this.briefBeingAnswered(history)
      : null;
    const briefResponse: BuilderBriefResponse | null = dto.briefResponse
      ? normaliseBriefResponse(briefAnswered, dto.briefResponse)
      : null;

    // Persist the admin's message first — the transcript survives whatever
    // happens next.
    const userContent = briefResponse
      ? renderBriefResponse(briefAnswered, briefResponse)
      : this.renderUserContent(dto);
    const userMetadata =
      dto.questionId || dto.answer || briefResponse
        ? {
            ...(dto.questionId ? { questionId: dto.questionId } : {}),
            ...(dto.answer ? { answer: dto.answer } : {}),
            ...(briefResponse ? { briefResponse } : {}),
          }
        : null;
    const userMessage = await this.messageRepository.appendMessage(sessionId, {
      role: BuilderMessageRole.USER,
      content: userContent,
      metadata: userMetadata,
      createdBy: userId,
    });

    // The assistant row is allocated now, empty, and rewritten as the turn
    // progresses. Allocating it at the end instead is what used to lose a
    // long turn's work to a restart: everything below accumulates in local
    // arrays, and until they reach a row they exist only in this process.
    const assistantMessage: BuilderMessage =
      await this.messageRepository.appendMessage(sessionId, {
        role: BuilderMessageRole.ASSISTANT,
        content: null,
        metadata: { model, streaming: true },
        createdBy: userId,
      });

    // Similar past builds, chosen once per session and frozen — the block they
    // land in is inside the cached prefix, so a selection that varied per turn
    // would cost more in cache misses than the examples are worth.
    const exemplars = await this.resolveExemplars(session);
    const handoffContext =
      await this.sessionService.getHandoffContext(sessionId);

    const context: BuilderToolExecutionContext = {
      session,
      doc,
      userId,
      validatedTurns,
      questionGate: protocol,
    };
    // The document as the turn found it: the receipt's "changed" is the
    // difference between this and what the turn leaves, so it describes what
    // the PRD now holds rather than what the edits set out to do.
    const draftBefore = JSON.parse(JSON.stringify(doc.draft ?? null));
    const versionBefore = doc.versionNumber;

    const turn = createTurnState();

    /**
     * Flush the accumulators onto the assistant row.
     *
     * Called after every model pass and every tool, and once more when the
     * turn settles. A failed checkpoint is logged and swallowed: losing a
     * save point is a smaller harm than killing a turn that is otherwise
     * working, and the next one supersedes it anyway.
     */
    const checkpoint = async (final: boolean): Promise<void> => {
      try {
        // Copied, not passed by reference: a checkpoint is a snapshot of the
        // turn as it stands, and the accumulators keep growing underneath it.
        await this.messageRepository.checkpointMessage(assistantMessage.id, {
          // What the admin saw. In a validated turn that is the delivered
          // reply alone; the model's other prose is working notes.
          content: validatedTurns
            ? turn.reply || null
            : turn.textParts.join('\n\n') || null,
          toolCalls:
            turn.allToolCalls.length > 0 ? [...turn.allToolCalls] : null,
          toolResults:
            turn.allToolResults.length > 0 ? [...turn.allToolResults] : null,
          metadata: {
            model,
            iterations: turn.iterations,
            stopReason: turn.stopReason,
            errored: turn.errored,
            loop: validatedTurns ? 'validated' : 'legacy',
            // Persisted, not just streamed: an `error` frame only reaches the
            // tab that was open when it happened. Without the message on the
            // row, a reload renders a failed turn as no turn at all — the
            // admin sees their own message answered by silence.
            ...(turn.error ? { errorMessage: turn.error } : {}),
            streaming: !final,
            ...(turn.questions.length > 0
              ? { questions: [...turn.questions] }
              : {}),
            ...(turn.workingNotes.length > 0
              ? { workingNotes: [...turn.workingNotes] }
              : {}),
            ...(turn.rejections > 0 ? { rejections: turn.rejections } : {}),
            ...(turn.receipt ? { receipt: turn.receipt } : {}),
            // The sweep and the brief live on the row, not the session: the
            // transcript is what a later turn, a reload and a replay all read.
            ...(turn.discovery ? { discovery: turn.discovery } : {}),
            ...(turn.situationBrief
              ? { situationBrief: turn.situationBrief }
              : {}),
          },
        });
      } catch (error) {
        this.logger.warn(
          `Builder session ${sessionId}: checkpoint failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    };

    // The discovery sweep, before the first pass: what exists is the server's
    // to look up, not the model's to remember to. Its lookups go through the
    // interview's own tools, so the evidence log records each one, and the
    // admin watches them in the chips they already know.
    if (briefDue) {
      const plan = await planDiscovery(
        this.llmCompletion,
        {
          sessionId,
          title: session.title,
          opening: userContent,
          handoff: handoffContext,
        },
        (problem) =>
          this.logger.warn(
            `Builder session ${sessionId}: discovery planner fell back (${problem}).`,
          ),
      );
      turn.discovery = yield* runDiscovery(
        plan.queries,
        async (name, input) => {
          const outcome = await this.executeTool(
            name,
            input,
            context,
            sessionId,
          );
          turn.discoveryCalls.push({
            name,
            input,
            result: outcome.modelResult ?? {},
          });
          return outcome;
        },
        plan.planned,
      );
      this.logger.info(
        `[BUILDER_INTERVIEW] session=${sessionId} discovery: ${
          turn.discovery.items.length
        } lookups (${plan.planned}), ${
          turn.discovery.items.filter((item) => item.ok && item.found.length)
            .length
        } found something`,
      );
      await checkpoint(false);
    }

    const system = await this.buildSystemBlocks(
      session.repos ?? undefined,
      exemplars,
      handoffContext,
      validatedTurns,
      protocol,
    );
    const messages: any[] = [
      ...(await this.replayHistory(session, history)),
      {
        role: 'user',
        content: this.buildLiveUserTurn(
          doc.draft,
          await this.readiness.assess(sessionId, doc),
          userContent,
          [
            ...(turn.discovery
              ? [
                  renderDiscoveryBlock(turn.discovery),
                  'This is the opening turn of the interview: read what matters, then end it ' +
                    'with `submit_situation_brief`. No question until the admin has answered it.',
                ]
              : []),
            ...(briefAnswered
              ? [renderBriefForModel(briefAnswered, briefResponse)]
              : []),
          ],
        ),
      },
    ];
    const tools = this.toolsService.getToolDefinitions({
      validatedTurns,
      situationBrief: protocol,
      briefDue,
    });

    const loop: InterviewLoopContext = {
      sessionId,
      provider,
      model,
      providerName,
      system,
      messages,
      tools,
      context,
      maxIterations,
      versionBefore,
      adminFreeText: this.adminWordsToApply(userMessage),
      checkpoint,
      protocol,
      briefDue,
    };

    try {
      if (validatedTurns) {
        yield* this.runValidatedLoop(loop, turn);
      } else {
        yield* this.runLegacyLoop(loop, turn);
      }
    } catch (error) {
      turn.errored = true;
      // Classified rather than relayed. What a provider throws is written for
      // whoever holds the API key, not for the admin mid-interview — and now
      // that three providers can run this turn, "what a raw error looks like"
      // is three different things. The classification is stable across them.
      const failure = classifyAgentProviderError(error);
      const message = BUILDER_PROVIDER_ERRORS[failure];
      turn.error = message;
      this.logger.error(
        `Builder interview turn failed for session ${sessionId} on ` +
          `${providerName}/${model} (${failure}): ` +
          describeAgentProviderError(error),
      );
      yield {
        event: 'error',
        data: { code: BUILDER_PROVIDER_ERROR_CODES[failure], message },
      };
    }

    // Last backstop against a silent turn. Every known way of producing one is
    // handled above, but the shape of the failure — the admin's message sitting
    // there with nothing under it — is indistinguishable from the agent having
    // hung, so anything that still gets here says so rather than settling
    // quietly.
    const saidNothing = validatedTurns
      ? !turn.reply && turn.questions.length === 0
      : turn.textParts.length === 0 && turn.allToolCalls.length === 0;
    if (!turn.errored && saidNothing) {
      turn.errored = true;
      // A validated turn can have done work and still not replied — the
      // receipt below lists it, so "nothing was written" would be untrue.
      const worked = validatedTurns && turn.allToolCalls.length > 0;
      turn.error = worked ? BUILDER_NO_REPLY_ERROR : BUILDER_EMPTY_TURN_ERROR;
      this.logger.warn(
        `Builder session ${sessionId}: turn ended without a reply ` +
          `(stop reason ${turn.stopReason ?? 'none'}, ` +
          `${turn.allToolCalls.length} tool call(s)).`,
      );
      yield {
        event: 'error',
        data: {
          code: worked ? 'no_reply' : 'empty_turn',
          message: turn.error,
        },
      };
    }

    // Built from what the tools returned and what the document now holds —
    // for a failed turn too, since edits that landed before the failure are
    // real and the admin should see them.
    turn.receipt = buildTurnReceipt({
      // The sweep's lookups first: the server ran them for this turn, and
      // the receipt is the record of what the turn looked at.
      calls: [
        ...turn.discoveryCalls,
        ...joinCallsToResults(turn.allToolCalls, turn.allToolResults),
      ],
      before: draftBefore,
      after: context.doc.draft,
      versionFrom: versionBefore,
      versionTo: context.doc.versionNumber,
      warnings: turn.warnings,
      prdUnchangedBecause: turn.prdUnchangedBecause,
    });

    // Settle the assistant row even for aborted turns: `streaming` goes false
    // here and nowhere else, so a row still marked open is a turn that died.
    await checkpoint(true);

    // Readiness may have moved during the turn; settle the status before the
    // client reads it off the `done` frame. Settling may run the cold
    // reviewer — a first review the turn's edits did not trigger, a retry of
    // a failed one, or a recheck of open findings against what changed — and
    // the admin is told it is running rather than left looking at a turn that
    // has gone quiet.
    let readiness: BuilderPrdReadiness;
    try {
      const plan = await this.readiness.plan(
        sessionId,
        context.doc,
        'turn_end',
      );
      readiness = plan.readiness;
      if (plan.review) {
        const name = plan.review === 'review' ? 'prd_review' : 'prd_recheck';
        yield { event: 'tool_call', data: { name, input: {} } };
        readiness = await this.readiness.runReview(
          sessionId,
          context.doc,
          plan.review,
          'turn_end',
        );
        const open = (readiness.review?.findings ?? []).filter(
          (finding) => finding.status === 'open',
        ).length;
        yield {
          event: 'tool_result',
          data: {
            name,
            summary:
              readiness.review?.status === 'failed'
                ? 'PRD review could not run; it will retry'
                : open
                  ? `PRD review: ${open} finding(s) to fix or dismiss`
                  : 'PRD review: nothing to fix',
          },
        };
      }
    } catch (error) {
      // The rubric's own inputs failed to load. Fall back to the draft-only
      // rubric rather than leave the turn without a status.
      this.logger.warn(
        `Builder session ${sessionId}: readiness settle failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      readiness = this.prdService.computeReadiness(context.doc.draft);
    }
    yield {
      event: 'readiness',
      data: readiness as unknown as Record<string, any>,
    };
    const sessionStatus = await this.sessionService.syncReadinessStatus(
      session,
      readiness,
    );

    // Last before `done`, after the reviewer's chip, so the receipt is what
    // the turn's activity settles into on screen — the same as on a reload.
    yield {
      event: 'receipt',
      data: turn.receipt as unknown as Record<string, any>,
    };
    yield {
      event: 'done',
      data: {
        messageSeq: assistantMessage.seq,
        sessionStatus,
        readinessScore: readiness.score,
      },
    };
  }

  /**
   * Whether this turn runs validated. Read per turn so the switch takes effect
   * on the next message; a settings read that fails keeps validated turns on,
   * the column's own default.
   */
  private async validatedTurnsEnabled(): Promise<boolean> {
    if (!this.settingsService) return true;
    try {
      return (await this.settingsService.get()).validatedTurns !== false;
    } catch (error) {
      this.logger.warn(
        `Builder settings unavailable; running a validated turn: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /**
   * Whether this turn runs the interview protocol (builder_settings.situationBrief).
   * Only meaningful with validated turns. Off when the settings carry no such
   * field — a fixture whose specs predate the protocol; the column always has
   * one — and when there is no settings service at all. A failed read keeps it
   * on, the column's own default.
   */
  private async situationBriefEnabled(): Promise<boolean> {
    if (!this.settingsService) return false;
    try {
      return (await this.settingsService.get()).situationBrief === true;
    } catch (error) {
      this.logger.warn(
        `Builder settings unavailable; running the situation brief: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }

  /**
   * Whether this turn's reply is the situation brief: none has been shown,
   * nothing has been asked (an interview that started before the protocol
   * keeps going as it was), and the sweep has not already run twice — a
   * first turn with nothing to brief on gets one more try, not a loop.
   */
  private isBriefDue(history: BuilderMessage[]): boolean {
    const assistant = history.filter(
      (message) => message.role === BuilderMessageRole.ASSISTANT,
    );
    if (assistant.some((message) => storedSituationBrief(message.metadata))) {
      return false;
    }
    if (
      assistant.some(
        (message) =>
          Array.isArray(message.metadata?.questions) &&
          message.metadata!.questions.length > 0,
      )
    ) {
      return false;
    }
    return (
      assistant.filter((message) => message.metadata?.discovery).length < 2
    );
  }

  /** The brief the admin is answering: the newest assistant row's, if it showed one. */
  private briefBeingAnswered(
    history: BuilderMessage[],
  ): BuilderSituationBrief | null {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message.role !== BuilderMessageRole.ASSISTANT) continue;
      return storedSituationBrief(message.metadata);
    }
    return null;
  }

  /**
   * What the admin said this turn in their own words — the text a validated
   * turn must record or explain. Null for an option pick or a plain "ok,
   * thanks", which the readiness rubric does not hold the PRD to either.
   */
  private adminWordsToApply(message: BuilderMessage): string | null {
    const text = freeTextOf(message);
    return text && !isAcknowledgement(text) ? text : null;
  }

  /**
   * The interview loop as it ran before validated turns: prose streams as it
   * is written, tools run in the order called, and `ask_admin` ends the loop
   * after its batch. Kept unchanged behind `builder_settings.validatedTurns`
   * so the switch is a real way back, and so the replay eval can compare the
   * two on the same fixtures.
   */
  private async *runLegacyLoop(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
  ): AsyncGenerator<BuilderSseFrame> {
    const {
      sessionId,
      provider,
      model,
      providerName,
      system,
      messages,
      tools,
      context,
      maxIterations,
      checkpoint,
    } = loop;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      turn.iterations = iteration + 1;

      const finalMessage = yield* this.runPass(provider, {
        model,
        maxTokens: BUILDER_INTERVIEW_MAX_TOKENS,
        system,
        messages,
        tools,
      });
      turn.stopReason = finalMessage.stopReason;
      this.recordUsage(
        finalMessage.usage,
        model,
        providerName,
        sessionId,
        turn.iterations,
      );

      // The model tried to call a tool and produced something unreadable, so
      // the turn arrives EMPTY — indistinguishable from it choosing to say
      // nothing. Gemini does this intermittently on a schema the size of the
      // interview's. Transient, so retry the same pass rather than settle a
      // turn that did nothing; the truncation budget bounds it.
      if (turn.stopReason === 'invalid_tool_call') {
        if (turn.invalidToolCalls >= BUILDER_MAX_TRUNCATION_RETRIES) {
          this.logger.warn(
            `Builder session ${sessionId}: ${providerName}/${model} returned ` +
              `an unreadable tool call ${turn.invalidToolCalls + 1} times; giving up.`,
          );
          turn.errored = true;
          turn.error = 'invalid_tool_call';
          yield {
            event: 'error',
            data: {
              code: 'invalid_tool_call',
              message: BUILDER_INVALID_TOOL_CALL_ERROR,
            },
          };
          break;
        }
        turn.invalidToolCalls += 1;
        this.logger.warn(
          `Builder session ${sessionId}: unreadable tool call from ` +
            `${providerName}/${model}; retrying (${turn.invalidToolCalls}).`,
        );
        continue;
      }

      const contentBlocks: any[] = finalMessage.content ?? [];
      for (const block of contentBlocks) {
        // Whitespace is not a reply. Gemini's empty STOP arrives as a bare
        // "\n", and counted as text it slipped past the empty-pass retry
        // below: the turn settled blank and the admin had to type
        // "continue" to get the interview moving again.
        if (block?.type === 'text' && block.text?.trim()) {
          turn.textParts.push(block.text);
        }
      }
      const toolUses = contentBlocks.filter(
        (block) => block?.type === 'tool_use',
      );

      // The model ran out of output room mid-message.
      //
      // This is the failure that looked like the agent going quiet: a
      // `max_tokens` stop carries whatever text it managed plus, usually, a
      // half-written tool_use whose `input` the SDK reconstructs by partial
      // JSON parse. Executing that would apply an arbitrary fragment of the
      // intended patch, so the block is dropped — but dropping it silently
      // is what produced turns that announced "writing the requirements
      // now" and wrote nothing, and turns that produced no row at all. Tell
      // the model what happened and let it re-do the write in pieces.
      if (turn.stopReason === 'max_tokens') {
        if (
          !(yield* this.handleTruncation(loop, turn, contentBlocks, toolUses))
        ) {
          break;
        }
        continue;
      }

      // A pass that said nothing and called nothing, on a turn that has so
      // far produced nothing either.
      //
      // Breaking here lands on the backstop below, which tells the admin to
      // send their message again — so the recovery was always "run the same
      // request a second time", and it was the person who had to do it,
      // after waiting for a turn that was never going to say anything. The
      // model is non-deterministic and the transcript is unchanged, so the
      // retry that works is the one we can make ourselves.
      //
      // Same bound and the same shape as the `invalid_tool_call` retry above
      // — these are two spellings of the same silence, one where the
      // provider names the cause and one where it does not.
      if (
        turn.stopReason !== 'tool_use' &&
        turn.textParts.length === 0 &&
        turn.allToolCalls.length === 0 &&
        turn.emptyPasses < BUILDER_MAX_TRUNCATION_RETRIES
      ) {
        turn.emptyPasses += 1;
        this.logger.warn(
          `Builder session ${sessionId}: ${providerName}/${model} returned an ` +
            `empty turn (stop reason ${turn.stopReason ?? 'none'}); retrying ` +
            `(${turn.emptyPasses}/${BUILDER_MAX_TRUNCATION_RETRIES}).`,
        );
        continue;
      }

      if (turn.stopReason !== 'tool_use' || toolUses.length === 0) {
        break;
      }

      // The prose of this pass is on the admin's screen already; save it
      // before spending minutes in the tools that follow.
      await checkpoint(false);

      messages.push({ role: 'assistant', content: contentBlocks });

      const toolResultBlocks: any[] = [];
      let endTurn = false;

      for (const toolUse of toolUses) {
        const name = String(toolUse.name);
        const input = (toolUse.input ?? {}) as Record<string, any>;
        yield { event: 'tool_call', data: { name, input } };
        turn.allToolCalls.push({ id: toolUse.id, name, input });

        const outcome = await this.executeTool(name, input, context, sessionId);

        for (const frame of outcome.events ?? []) {
          if (frame.event === 'question') {
            turn.questions.push(frame.data);
          }
          yield frame;
        }
        yield {
          event: 'tool_result',
          data: { name, summary: outcome.summary },
        };

        turn.allToolResults.push({
          toolUseId: toolUse.id,
          name,
          result: outcome.modelResult,
        });
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(outcome.modelResult),
        });
        // Per tool, not per iteration: a github_read_file that returns a
        // large file, or a stacks_search, is exactly the work nobody wants
        // to pay for twice.
        await checkpoint(false);
        if (outcome.endTurn) {
          endTurn = true;
        }
      }

      messages.push({ role: 'user', content: toolResultBlocks });

      if (endTurn) {
        turn.stopReason = 'end_turn';
        break;
      }
    }

    // The iteration cap landed on a truncated pass, so the retry above never
    // got to run. Nothing was applied, and the admin is owed the same
    // explanation as the give-up path.
    if (turn.stopReason === 'max_tokens' && !turn.errored) {
      turn.errored = true;
      turn.error = BUILDER_TRUNCATION_ERROR;
      yield {
        event: 'error',
        data: {
          code: 'response_truncated',
          message: BUILDER_TRUNCATION_ERROR,
        },
      };
    }

    // Budget exhausted while the model still wanted tools: one tool-less
    // pass so the turn ends in prose rather than a raw error.
    if (turn.stopReason === 'tool_use') {
      this.logger.warn(
        `Builder session ${sessionId} hit the ${maxIterations}-iteration cap; ` +
          'making a tool-less wrap-up pass.',
      );
      const wrapUpMessage = yield* this.runPass(provider, {
        model,
        maxTokens: BUILDER_INTERVIEW_MAX_TOKENS,
        system,
        messages,
      });
      this.recordUsage(
        wrapUpMessage.usage,
        model,
        providerName,
        sessionId,
        turn.iterations,
      );
      for (const block of wrapUpMessage.content ?? []) {
        if (block?.type === 'text' && block.text) {
          turn.textParts.push(block.text);
        }
      }
      turn.stopReason = wrapUpMessage.stopReason ?? 'end_turn';
    }
  }

  /**
   * A pass cut off at the output cap. Its tool calls are fragments and are
   * dropped; the model is told so and asked to write again in pieces. Returns
   * false once the retries are spent, having said so to the admin.
   */
  private async *handleTruncation(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
    contentBlocks: any[],
    toolUses: any[],
  ): AsyncGenerator<BuilderSseFrame, boolean> {
    const { sessionId, messages, checkpoint } = loop;
    turn.truncations += 1;
    if (turn.truncations > BUILDER_MAX_TRUNCATION_RETRIES) {
      this.logger.error(
        `Builder session ${sessionId}: model output still truncated at ` +
          `${BUILDER_INTERVIEW_MAX_TOKENS} tokens after ` +
          `${BUILDER_MAX_TRUNCATION_RETRIES} retries; ending the turn.`,
      );
      turn.errored = true;
      turn.error = BUILDER_TRUNCATION_ERROR;
      yield {
        event: 'error',
        data: {
          code: 'response_truncated',
          message: BUILDER_TRUNCATION_ERROR,
        },
      };
      return false;
    }

    this.logger.warn(
      `Builder session ${sessionId}: model output truncated at ` +
        `${BUILDER_INTERVIEW_MAX_TOKENS} tokens ` +
        `(retry ${turn.truncations}/${BUILDER_MAX_TRUNCATION_RETRIES}, ` +
        `${toolUses.length} tool call(s) discarded).`,
    );

    await checkpoint(false);

    // Only the completed text blocks are replayed — a truncated
    // tool_use has no result to pair it with, and the API rejects a
    // dangling one.
    const textBlocks = contentBlocks.filter(
      (block) => block?.type === 'text' && block.text,
    );
    if (textBlocks.length > 0) {
      messages.push({ role: 'assistant', content: textBlocks });
    }
    messages.push({ role: 'user', content: BUILDER_TRUNCATION_NUDGE });
    return true;
  }

  /** Run one tool, turning a throw into a result the model can repair from. */
  private async executeTool(
    name: string,
    input: Record<string, any>,
    context: BuilderToolExecutionContext,
    sessionId: string,
  ): Promise<BuilderToolExecutionOutcome> {
    try {
      return await this.toolsService.execute(name, input, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Builder tool "${name}" failed for session ${sessionId}: ${message}`,
      );
      // Handed back as a result rather than thrown: the model can
      // usually repair a bad call, and a thrown error ends the turn.
      return {
        modelResult: { ok: false, error: 'tool_failed', message },
        summary: `Tool ${name} failed: ${message}`,
      };
    }
  }

  /**
   * A validated turn: the reply reaches the admin only once it is true.
   *
   * The turn ends through `ask_admin` or `finish_turn`, and that call is
   * checked before anything is shown. Not delivered — the model is told why
   * and the loop goes on — when the same step held a call that failed or a
   * lookup whose result the model had not read yet; when an earlier PRD edit
   * failed and nothing repaired it; when the message says the PRD changed and
   * it did not, or says it is ready and it is not; or when the admin's own
   * words this turn changed nothing and the model did not say why. Each
   * problem is held against the reply once: raised again, it goes through as
   * a warning on the receipt rather than looping. After two rejections the
   * next step can only edit and end the turn, and whatever it sends is
   * delivered with what it still gets wrong listed under it.
   *
   * Nothing the model writes outside the turn-ending call is shown — it is
   * kept as working notes. The opportunity copilot's `submit_turn` is the
   * pattern; it has filed every roadmap opportunity this way.
   */
  private async *runValidatedLoop(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
  ): AsyncGenerator<BuilderSseFrame> {
    const {
      sessionId,
      provider,
      model,
      providerName,
      system,
      messages,
      tools,
      maxIterations,
      checkpoint,
    } = loop;
    const endingTools = tools.filter((tool) =>
      BUILDER_TERMINAL_TOOLS.has(String(tool.name)),
    );
    const editAndEndingTools = tools.filter(
      (tool) =>
        BUILDER_TERMINAL_TOOLS.has(String(tool.name)) ||
        BUILDER_PRD_EDIT_TOOLS.has(String(tool.name)),
    );
    // Prose without a turn-ending call: nudged once with every tool still on
    // offer (it may need to edit first), then offered only the ending tools.
    let nudged = false;
    let mustEnd = false;
    // Room for the retries (unreadable calls, empty passes, truncation), each
    // bounded by its own counter, on top of the iteration cap.
    const hardStop = maxIterations + 2 * BUILDER_MAX_TRUNCATION_RETRIES;

    for (let iteration = 0; iteration < hardStop; iteration++) {
      turn.iterations = iteration + 1;
      const lastPass = mustEnd || iteration >= maxIterations - 1;
      const lenient = turn.rejections >= BUILDER_MAX_TURN_REJECTIONS;
      const offered = lastPass
        ? endingTools
        : lenient
          ? editAndEndingTools
          : tools;

      const finalMessage = yield* this.runPass(
        provider,
        {
          model,
          maxTokens: BUILDER_INTERVIEW_MAX_TOKENS,
          system,
          messages,
          tools: offered,
        },
        false,
      );
      turn.stopReason = finalMessage.stopReason;
      this.recordUsage(
        finalMessage.usage,
        model,
        providerName,
        sessionId,
        turn.iterations,
      );

      if (turn.stopReason === 'invalid_tool_call') {
        if (turn.invalidToolCalls >= BUILDER_MAX_TRUNCATION_RETRIES) {
          this.logger.warn(
            `Builder session ${sessionId}: ${providerName}/${model} returned ` +
              `an unreadable tool call ${turn.invalidToolCalls + 1} times; giving up.`,
          );
          turn.errored = true;
          turn.error = 'invalid_tool_call';
          yield {
            event: 'error',
            data: {
              code: 'invalid_tool_call',
              message: BUILDER_INVALID_TOOL_CALL_ERROR,
            },
          };
          return;
        }
        turn.invalidToolCalls += 1;
        continue;
      }

      const contentBlocks: any[] = finalMessage.content ?? [];
      const textBlocks = contentBlocks.filter(
        (block) => block?.type === 'text' && block.text?.trim(),
      );
      const passText = textBlocks
        .map((block) => String(block.text).trim())
        .join('\n\n');
      const toolUses = contentBlocks.filter(
        (block) => block?.type === 'tool_use',
      );
      if (passText) turn.workingNotes.push(passText);

      if (turn.stopReason === 'max_tokens') {
        if (
          !(yield* this.handleTruncation(loop, turn, contentBlocks, toolUses))
        ) {
          return;
        }
        continue;
      }

      if (toolUses.length === 0) {
        // Nothing at all: the same request again, as the legacy loop does.
        if (!passText && turn.emptyPasses < BUILDER_MAX_TRUNCATION_RETRIES) {
          turn.emptyPasses += 1;
          this.logger.warn(
            `Builder session ${sessionId}: ${providerName}/${model} returned an ` +
              `empty pass; retrying (${turn.emptyPasses}/${BUILDER_MAX_TRUNCATION_RETRIES}).`,
          );
          continue;
        }
        if (!lastPass) {
          // Ended in prose. Nothing outside a turn-ending call reaches the
          // admin, so ask for one — kept in the history, so the next pass can
          // turn its own notes into the message.
          if (textBlocks.length) {
            messages.push({ role: 'assistant', content: textBlocks });
          }
          messages.push({
            role: 'user',
            content: nudged
              ? BUILDER_END_TURN_NUDGE_FINAL
              : BUILDER_END_TURN_NUDGE,
          });
          if (nudged) mustEnd = true;
          nudged = true;
          continue;
        }
        // Still prose with only the ending tools on offer. Its notes are
        // shown rather than nothing, and the receipt says so.
        const fallback =
          passText || turn.workingNotes[turn.workingNotes.length - 1] || '';
        if (fallback) {
          yield* this.deliverReply(loop, turn, null, fallback, [
            BUILDER_PROSE_FALLBACK_WARNING,
          ]);
        }
        return;
      }

      // The notes of this pass are saved before the tools run for minutes.
      await checkpoint(false);
      messages.push({ role: 'assistant', content: contentBlocks });

      const endings = toolUses.filter((use) =>
        BUILDER_TERMINAL_TOOLS.has(String(use.name)),
      );
      const others = toolUses.filter(
        (use) => !BUILDER_TERMINAL_TOOLS.has(String(use.name)),
      );
      const offeredNames = new Set(offered.map((tool) => String(tool.name)));
      const results = new Map<string, Record<string, any>>();
      yield* this.runValidatedCalls(loop, turn, others, offeredNames, results);

      const answer = (extra: Record<string, Record<string, any>> = {}) =>
        messages.push({
          role: 'user',
          content: toolUses.map((use) => ({
            type: 'tool_result',
            tool_use_id: use.id,
            content: JSON.stringify(extra[use.id] ?? results.get(use.id) ?? {}),
          })),
        });

      if (!endings.length) {
        answer();
        continue;
      }

      // One reply per turn. A second turn-ending call in the same step is
      // dropped — usually a second question, which belongs in the next turn.
      const [ending, ...extraEndings] = endings;
      const dropped: Record<string, Record<string, any>> = {};
      for (const extra of extraEndings) {
        dropped[extra.id] = {
          ok: false,
          delivered: false,
          error: 'one_reply_per_turn',
          message:
            'Only the first turn-ending call in a step counts; this one was dropped. Ask ' +
            'the next question after the admin answers.',
        };
        turn.allToolCalls.push({
          id: extra.id,
          name: String(extra.name),
          input: extra.input ?? {},
        });
        turn.allToolResults.push({
          toolUseId: extra.id,
          name: String(extra.name),
          result: dropped[extra.id],
        });
      }

      const input = (ending.input ?? {}) as Record<string, any>;
      const message = String(input.message ?? '').trim() || passText;
      const problems = await this.replyProblems(
        loop,
        turn,
        String(ending.name),
        input,
        message,
        others,
        results,
        offeredNames.has(String(ending.name)),
      );
      const blocking = problems.filter(
        (problem) => !turn.raised.has(problem.key),
      );

      if (blocking.length && !lenient && !lastPass) {
        turn.rejections += 1;
        problems.forEach((problem) => turn.raised.add(problem.key));
        const rejection = {
          ok: false,
          delivered: false,
          error: 'not_delivered',
          message:
            'Not delivered — the admin has not seen this turn. Fix what is listed, then end ' +
            'the turn again.',
          reasons: problems.map((problem) => problem.toModel),
        };
        turn.allToolCalls.push({
          id: ending.id,
          name: String(ending.name),
          input,
        });
        turn.allToolResults.push({
          toolUseId: ending.id,
          name: String(ending.name),
          result: rejection,
        });
        this.logger.info(
          `[BUILDER_INTERVIEW] session=${sessionId} ${ending.name} not delivered ` +
            `(${turn.rejections}): ${problems.map((problem) => problem.key).join(', ')}`,
        );
        answer({ ...dropped, [ending.id]: rejection });
        await checkpoint(false);
        continue;
      }

      yield* this.deliverReply(
        loop,
        turn,
        ending,
        message,
        problems.map((problem) => problem.toAdmin),
      );
      return;
    }
  }

  /**
   * The calls of one validated step, other than the turn-ending one. Lookups
   * run together — they only read — and are reported together; edits run
   * after them, one at a time and in order, because each one changes the
   * document the next one applies to.
   */
  private async *runValidatedCalls(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
    uses: any[],
    offeredNames: Set<string>,
    results: Map<string, Record<string, any>>,
  ): AsyncGenerator<BuilderSseFrame> {
    const { sessionId, context, checkpoint } = loop;
    const record = function* (
      use: any,
      outcome: BuilderToolExecutionOutcome,
    ): Generator<BuilderSseFrame> {
      const name = String(use.name);
      for (const frame of outcome.events ?? []) yield frame;
      yield { event: 'tool_result', data: { name, summary: outcome.summary } };
      turn.allToolResults.push({
        toolUseId: use.id,
        name,
        result: outcome.modelResult,
      });
      results.set(use.id, outcome.modelResult);
    };
    const run = (use: any): Promise<BuilderToolExecutionOutcome> =>
      offeredNames.has(String(use.name))
        ? this.executeTool(
            String(use.name),
            (use.input ?? {}) as Record<string, any>,
            context,
            sessionId,
          )
        : Promise.resolve({
            modelResult: {
              ok: false,
              error: 'not_available',
              message:
                'Not run: at this point in the turn only ending it (and editing the PRD) is ' +
                'available.',
            },
            summary: `${use.name} not run`,
          });

    const lookups = uses.filter((use) => isResearchTool(String(use.name)));
    const rest = uses.filter((use) => !lookups.includes(use));
    for (const use of lookups) {
      const name = String(use.name);
      const input = (use.input ?? {}) as Record<string, any>;
      yield { event: 'tool_call', data: { name, input } };
      turn.allToolCalls.push({ id: use.id, name, input });
    }
    const outcomes = await Promise.all(lookups.map(run));
    for (const [index, use] of lookups.entries()) {
      yield* record(use, outcomes[index]);
    }
    if (lookups.length) await checkpoint(false);

    for (const use of rest) {
      const name = String(use.name);
      const input = (use.input ?? {}) as Record<string, any>;
      yield { event: 'tool_call', data: { name, input } };
      turn.allToolCalls.push({ id: use.id, name, input });
      yield* record(use, await run(use));
      await checkpoint(false);
    }
  }

  /**
   * What the session's lookups this turn found or read, as text a brief
   * citation can match: files by path, search hits by `repo:path`, and every
   * discovery finding. Searches that failed back nothing.
   */
  private turnSources(turn: InterviewTurnState): string[] {
    const sources: string[] = [];
    for (const item of turn.discovery?.items ?? []) {
      if (item.ok) sources.push(...item.found);
    }
    for (const call of [
      ...turn.discoveryCalls,
      ...joinCallsToResults(turn.allToolCalls, turn.allToolResults),
    ]) {
      if (!call.result || call.result.ok === false) continue;
      if (!isResearchTool(call.name)) continue;
      const repo = call.input?.repo ? String(call.input.repo) : '';
      const path = call.input?.path ? String(call.input.path) : '';
      if (path) sources.push(path, `${repo}:${path}`, `${repo}/${path}`);
      sources.push(...foundLines(call.result));
    }
    return [...new Set(sources.filter(Boolean))];
  }

  /**
   * What is wrong with a reply, checked before it is shown. Each problem has
   * a key, so the same problem holds a reply back once (`turn.raised`), and
   * two phrasings: what the model needs to fix it, and what the admin reads
   * on the receipt if the reply goes out anyway.
   */
  private async replyProblems(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
    endingName: string,
    input: Record<string, any>,
    message: string,
    others: any[],
    results: Map<string, Record<string, any>>,
    offered = true,
  ): Promise<ReplyProblem[]> {
    const { sessionId, context, versionBefore, adminFreeText } = loop;
    const problems: ReplyProblem[] = [];
    const isBrief = endingName === 'submit_situation_brief';

    // An ending this step was not offered: a question before the brief, or a
    // brief once there is no brief to give.
    if (!offered) {
      problems.push({
        key: 'not_offered',
        toModel: loop.briefDue
          ? 'This is the opening turn: end it with `submit_situation_brief`. The admin sees ' +
            'what you found before you ask them anything.'
          : `\`${endingName}\` is not available now — end with \`ask_admin\` or \`finish_turn\`.`,
        toAdmin: loop.briefDue
          ? 'Builder asked a question before showing what it found.'
          : 'Builder ended the turn with a tool it was not offered.',
      });
    }

    if (isBrief) {
      const { brief, problems: briefProblems } = normaliseSituationBrief(
        input,
        { discovery: turn.discovery, sources: this.turnSources(turn) },
      );
      turn.pendingBrief = brief;
      problems.push(...briefProblems);
    }

    if (loop.protocol && endingName === 'ask_admin') {
      problems.push(...questionGateProblems(input));
    }
    const describe = (use: any) =>
      describeToolAttempt(
        String(use.name),
        (use.input ?? {}) as Record<string, any>,
      );

    const failedHere = others.filter(
      (use) => results.get(use.id)?.ok === false,
    );
    if (failedHere.length) {
      problems.push({
        key: `failed:${failedHere.map((use) => use.id).join(',')}`,
        toModel:
          `${failedHere.length === 1 ? 'A call' : `${failedHere.length} calls`} in this step ` +
          'failed, and the reply was written without knowing it: ' +
          failedHere
            .map(
              (use) =>
                `${describe(use)} — ${describeToolFailure(results.get(use.id) ?? {})}`,
            )
            .join('; ') +
          '. Repair it or try another way — or, if it cannot be done, say so in the message.',
        toAdmin: `Written before Builder saw that ${
          failedHere.length === 1 ? 'a call' : `${failedHere.length} calls`
        } in the same step failed.`,
      });
    }

    const unread = others.filter(
      (use) =>
        isResearchTool(String(use.name)) && results.get(use.id)?.ok !== false,
    );
    if (unread.length) {
      problems.push({
        key: `unread:${unread.map((use) => use.id).join(',')}`,
        toModel:
          `You ended the turn in the same step as ${unread.length} lookup(s) (` +
          unread.map(describe).join('; ') +
          '), so the reply was written before their results existed. The results are with ' +
          'this message: read them, then end the turn.',
        toAdmin: `Written before Builder had read ${unread.length} of its lookups.`,
      });
    }

    // An edit that failed in an earlier step, with no successful edit since.
    const edits = joinCallsToResults(
      turn.allToolCalls,
      turn.allToolResults,
    ).filter((call) => BUILDER_PRD_EDIT_TOOLS.has(call.name) && call.result);
    const lastFailure = edits
      .map((call) => call.result?.ok === false)
      .lastIndexOf(true);
    const lastSuccess = edits
      .map((call) => call.result?.ok !== false)
      .lastIndexOf(true);
    const failedEditHere = failedHere.some((use) =>
      BUILDER_PRD_EDIT_TOOLS.has(String(use.name)),
    );
    if (lastFailure > lastSuccess && !failedEditHere) {
      const call = edits[lastFailure];
      problems.push({
        key: `unrepaired:${lastFailure}`,
        toModel:
          `Your last PRD edit failed and nothing since has repaired it: ${describeToolAttempt(
            call.name,
            call.input,
          )} — ${describeToolFailure(call.result ?? {})}. Repair it, or say in the message ` +
          'that it did not land.',
        toAdmin: 'A PRD edit failed and nothing repaired it.',
      });
    }

    const versionMoved = context.doc.versionNumber !== versionBefore;
    if (claimsPrdEdit(message) && !versionMoved) {
      problems.push({
        key: 'claims_edit',
        toModel:
          'Your message says the PRD changed, but nothing in it changed this turn. Make the ' +
          'edit first — or, if you have not decided to change it, do not say you did.',
        toAdmin:
          'Builder said the PRD changed, but nothing in it changed this turn.',
      });
    }

    if (claimsPrdReady(message)) {
      const readiness = await this.readiness.assess(sessionId, context.doc);
      if (!readiness.ready) {
        problems.push({
          key: 'claims_ready',
          toModel:
            'Your message says the PRD is ready, and readiness says it is not: ' +
            readiness.blockers.slice(0, 4).join(' | ') +
            '. Fix those, or say what is left instead.',
          toAdmin:
            'Builder said the PRD is ready; the readiness check disagrees.',
        });
      }
    }

    // The brief is what the admin's words become before the PRD does: it is
    // answered first, then written.
    if (
      adminFreeText &&
      !isBrief &&
      !versionMoved &&
      !String(input.prdUnchangedBecause ?? '').trim()
    ) {
      problems.push({
        key: 'unapplied_message',
        toModel:
          `The admin's message ("${clipText(adminFreeText, 160)}") has not changed the PRD. ` +
          'Record what it settles before you end the turn — or, if it changes nothing in ' +
          'the PRD, say why in prdUnchangedBecause.',
        toAdmin:
          "Your message hasn't changed the PRD, and Builder didn't say why.",
      });
    }

    if (endingName === 'finish_turn' && !message) {
      problems.push({
        key: 'empty_message',
        toModel:
          'finish_turn needs a message — it is the only thing the admin sees.',
        toAdmin: 'Builder ended the turn without a message.',
      });
    }
    if (endingName === 'ask_admin' && !String(input.prompt ?? '').trim()) {
      problems.push({
        key: 'empty_prompt',
        toModel: 'ask_admin needs a prompt — the question itself.',
        toAdmin: 'Builder asked a question with no text.',
      });
    }
    return problems;
  }

  /**
   * Show the reply: its message as one `token` frame (the stream contract the
   * UI already renders), then the question card if it asked one. `ending` is
   * null for the prose fallback, which asks nothing.
   */
  private async *deliverReply(
    loop: InterviewLoopContext,
    turn: InterviewTurnState,
    ending: any | null,
    message: string,
    warnings: string[],
  ): AsyncGenerator<BuilderSseFrame> {
    const { sessionId, context, checkpoint } = loop;
    const questionFrames: BuilderSseFrame[] = [];
    if (ending) {
      const name = String(ending.name);
      const input = (ending.input ?? {}) as Record<string, any>;
      const outcome = await this.executeTool(name, input, context, sessionId);
      for (const frame of outcome.events ?? []) {
        if (frame.event === 'question') {
          turn.questions.push(frame.data);
          questionFrames.push(frame);
        }
      }
      // The brief was checked against the evidence on the way here; what
      // the admin gets is that checked copy, with its line ids and labels.
      if (name === 'submit_situation_brief' && turn.pendingBrief) {
        turn.situationBrief = {
          ...turn.pendingBrief,
          message: message || turn.pendingBrief.message,
        };
        questionFrames.push({
          event: 'situation_brief',
          data: turn.situationBrief as unknown as Record<string, any>,
        });
      }
      turn.allToolCalls.push({ id: ending.id, name, input });
      turn.allToolResults.push({
        toolUseId: ending.id,
        name,
        result: { ...outcome.modelResult, delivered: true },
      });
      const unchanged = String(input.prdUnchangedBecause ?? '').trim();
      turn.prdUnchangedBecause = unchanged || null;
    }

    // A reply that was the pass's own prose, not a field of the call, is the
    // reply now rather than a working note.
    const notes = turn.workingNotes;
    if (message && notes[notes.length - 1] === message) notes.pop();

    turn.reply = message || null;
    turn.warnings.push(...warnings);
    turn.stopReason = 'end_turn';
    if (message) yield { event: 'token', data: { delta: message } };
    for (const frame of questionFrames) yield frame;
    await checkpoint(false);
  }

  /**
   * Build the persisted user-turn content. A structured `answer` (from an
   * option card) renders into a deterministic suffix — labels arrive via
   * `message`, ids/custom/none via `answer` — so the agent acts on exact
   * selections while the raw payload stays in metadata for faithful resume.
   */
  private renderUserContent(dto: CreateBuilderMessageDto): string {
    const prefix = dto.questionId
      ? `[answers question ${dto.questionId}] `
      : '';
    const base = (dto.message ?? '').trim();
    const answer = dto.answer;
    if (!answer) {
      return `${prefix}${base}`.trim();
    }
    const parts: string[] = [];
    if (answer.none) {
      parts.push('none of these');
    }
    if (answer.selectedOptionIds?.length) {
      parts.push(`selected ids: ${answer.selectedOptionIds.join(', ')}`);
    }
    if (answer.customValues?.length) {
      parts.push(
        `custom: ${answer.customValues.map((value) => `"${value}"`).join(', ')}`,
      );
    }
    const suffix = parts.length ? ` [${parts.join(' | ')}]` : '';
    return `${prefix}${base}${suffix}`.trim();
  }

  /**
   * The live turn carries the current PRD alongside the admin's words.
   *
   * It is attached here, to the newest user message, rather than to the
   * system prompt for two reasons: the system prefix stays byte-identical and
   * therefore cacheable, and the model always sees the document as it is now
   * rather than as it was when the session started.
   */
  private buildLiveUserTurn(
    draft: unknown,
    readiness: BuilderPrdReadiness,
    userContent: string,
    extra: string[] = [],
  ): string {
    const blockers = readiness.blockers.length
      ? readiness.blockers.map((blocker) => `- ${blocker}`).join('\n')
      : '- none; the PRD is build-ready';
    return [
      '<current_prd>',
      JSON.stringify(draft),
      '</current_prd>',
      '',
      `<readiness score="${readiness.score}" ready="${readiness.ready}">`,
      blockers,
      '</readiness>',
      '',
      // The discovery sweep, or the brief being answered: this turn's
      // evidence, read before the admin's words it is for.
      ...extra.flatMap((block) => [block, '']),
      userContent,
    ].join('\n');
  }

  /**
   * System blocks: instructions + Ally context, both marked for caching.
   *
   * Returned as an array of blocks (not a string) because `cache_control`
   * attaches per-block; the boundary after the last cached block is what the
   * API reuses on the next turn.
   */
  /**
   * The exemplar digests for this session, persisting the choice the first
   * time so later turns reuse it byte-for-byte.
   *
   * Best-effort: worked examples are a nice-to-have, and an interview turn must
   * not fail because a ranking call did.
   */
  private async resolveExemplars(session: BuilderSession): Promise<string[]> {
    try {
      const { digests, chosen } =
        await this.exemplarService.digestsForSession(session);
      if (chosen) {
        await this.sessionRepository.update(
          { id: session.id },
          {
            contextExemplarIds: chosen,
            contextExemplarRepos: session.repos ?? [],
          },
        );
      }
      return digests;
    } catch (error) {
      this.logger.warn(
        `Could not resolve exemplars for session ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async buildSystemBlocks(
    repos?: string[],
    exemplars: string[] = [],
    handoffContext: string | null = null,
    validatedTurns = false,
    protocol = false,
  ): Promise<AgentSystemBlock[]> {
    const [instructions, context, platformRules, platformMap] =
      await Promise.all([
        this.buildSystemPrompt(),
        this.knowledgeService.buildContextBlock(repos, exemplars),
        this.knowledgeService.platformRules(),
        this.platformContext?.render() ?? Promise.resolve(''),
      ]);
    // Typed, not `any[]`. These used to be Anthropic's own shape
    // (`cache_control: ephemeral`) written straight into the request; the
    // provider-neutral layer takes `cache` instead and each adapter honours it
    // as it can. Returning the old shape through an `any` would have compiled
    // cleanly and silently stopped caching anything, which is the failure this
    // whole split exists to prevent.
    // The platform rules ride the instructions block: as stable as it is,
    // so they cost no extra cache breakpoint, and read before the context so
    // the technical plan is written knowing them. The plan that renamed a
    // persisted key in session 880e73e6 was written by this agent, which had
    // never been told released clients lag the backend.
    // The turn protocol rides the same block, after the rules: how a turn
    // ends is code's to say, not the dashboard prompt's, and it is only true
    // while validated turns are on.
    // The interview protocol follows it, on the same terms.
    const turnProtocol = validatedTurns
      ? `\n\n${BUILDER_TURN_PROTOCOL}${
          protocol ? `\n\n${BUILDER_INTERVIEW_PROTOCOL}` : ''
        }`
      : '';
    const blocks: AgentSystemBlock[] = [
      {
        text: `${instructions}\n\n${platformRules}${turnProtocol}`,
        cache: true,
      },
      { text: context, cache: true },
    ];
    // The reusable systems and the docs index: what already exists, read before any question.
    // Its own block because it refreshes on its own schedule; shared by every session, so it
    // stays inside the common prefix. Session 2bc3a5cf proposed rebuilding Auto-improve
    // because nothing in its context said Auto-improve existed.
    if (platformMap.trim()) {
      blocks.push({ text: platformMap, cache: true });
    }
    // Last, so the two blocks above stay a prefix shared with every other session. Frozen
    // per session, so it caches as well as they do.
    if (handoffContext) {
      blocks.push({ text: this.renderHandoff(handoffContext), cache: true });
    }
    return blocks;
  }

  /**
   * What the work before this session settled, with how to use it.
   *
   * The instructions live here, beside the block, rather than in the interviewer prompt: the
   * block only exists for sessions something else started, and a rule in the prompt about a
   * block most sessions never see is one more thing every other interview reads past. Written
   * after a live session opened from a roadmap opportunity spent its first questions on what
   * the filing interview had already decided — debrief-specific feedback alongside the
   * session rating, and the rating's shape, were both in the copilot's brief it was never
   * shown.
   *
   * "Reference what was said rather than asking from scratch" is Stacks, "Sequencing
   * clarification questions to avoid user overwhelm".
   */
  private renderHandoff(handoffContext: string): string {
    return [
      '# Hand-off — what was settled before this session started',
      '',
      'This session was opened from earlier work, and what follows is its record. The admin ' +
        'has already answered these questions once. So:',
      '',
      '- Treat every decision in it as settled. Write what it settles into the PRD with ' +
        '`update_prd` on your first turn, before you ask anything.',
      '- Ask only about what it leaves open — usually how it gets built, not whether or for ' +
        'whom. Never re-ask something it answers, including as a "just to confirm" question.',
      '- Reuse its research. Where it cites a file, a query or a board item, start from that ' +
        'reference rather than searching again from nothing.',
      '- When the code contradicts it, or two parts of it disagree, quote what was said and ask ' +
        'which should give — that is a contradiction to resolve, not a fresh question.',
      '- Alternatives it records as dropped stay dropped unless the admin reopens them.',
      '',
      '<handoff>',
      handoffContext,
      '</handoff>',
    ].join('\n');
  }

  /**
   * Interviewer system prompt from the prompt registry. A missing prompt
   * (e.g. before the first sync) degrades to a minimal built-in instruction
   * rather than failing the turn.
   */
  private async buildSystemPrompt(): Promise<string> {
    // Memoised for a minute. This is one or two queries plus a filesystem read,
    // and it ran on every single turn for a template that changes when someone
    // edits a prompt in the admin UI — a minute of staleness there is nobody's
    // problem, and the turn is the latency a person is actually sitting through.
    const now = Date.now();
    if (this.systemPromptCache && this.systemPromptCache.expiresAt > now) {
      return this.systemPromptCache.text;
    }

    try {
      const template = await this.promptSharedService.getPromptByCode(
        BUILDER_PROMPTS.INTERVIEWER_SYSTEM,
      );
      if (template) {
        this.systemPromptCache = {
          text: template,
          expiresAt: now + BUILDER_SYSTEM_PROMPT_TTL_MS,
        };
        return template;
      }
    } catch (error) {
      this.logger.warn(
        `Builder interviewer prompt unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return (
      'You are a product-requirements interviewer for the Ally platform. Ask the ' +
      'admin ONE question at a time via ask_admin, always with recommended options ' +
      'and a custom answer. Research the codebase with the github_* tools and product ' +
      'guidance with stacks_search before you assume. Keep the PRD up to date with ' +
      'update_prd as you learn, and drive it to full readiness.'
    );
  }

  /**
   * Rebuild the Anthropic messages array from persisted rows: assistant rows
   * contribute their text + tool_use blocks, followed by a user turn carrying
   * the recorded tool_result blocks (Anthropic requires every tool_use to be
   * answered before the next real user message).
   */
  /**
   * The transcript to replay, summarising the oldest turns once it grows.
   *
   * Full replay every turn is what made a long interview cost more each time:
   * only the two system blocks are cached, so the transcript is re-read at
   * full price on every turn and a twenty-turn interview with heavy tool
   * results grows monotonically. The summary sits *outside* the cached prefix
   * on purpose — it changes, and putting it inside would bust the cache it was
   * meant to protect — but it still replaces far more tokens than it costs.
   *
   * Best-effort: a failed summarisation falls back to full replay, which is
   * expensive rather than broken.
   */
  private async replayHistory(
    session: BuilderSession,
    history: BuilderMessage[],
  ): Promise<any[]> {
    if (history.length <= BUILDER_INTERVIEW_SUMMARY_AFTER_MESSAGES) {
      return this.rebuildAnthropicHistory(history);
    }

    try {
      const keep = BUILDER_INTERVIEW_SUMMARY_KEEP_RECENT;
      // Never split a tool_use from its tool_result: the API rejects a
      // dangling tool_use, and the boundary has to fall on a user message.
      let boundary = history.length - keep;
      while (
        boundary > 0 &&
        history[boundary].role !== BuilderMessageRole.USER
      ) {
        boundary -= 1;
      }
      if (boundary <= 0) return this.rebuildAnthropicHistory(history);

      // Reuse a stored summary that already covers this boundary. Without
      // this the summary was recomputed from scratch on EVERY turn past the
      // fortieth — one extra model call per turn, for a digest of messages
      // that cannot change, since the turns being summarised are all in the
      // past.
      const boundarySeq = history[boundary - 1]?.seq ?? 0;
      const cached = (session.metadata ?? {}) as Record<string, any>;
      const stored = cached.interviewSummary as
        | { uptoSeq?: number; text?: string }
        | undefined;

      let summary: string | null =
        stored?.text && stored.uptoSeq === boundarySeq ? stored.text : null;

      if (!summary) {
        summary = await this.summariseTurns(
          session,
          history.slice(0, boundary),
        );
        if (summary) {
          // Best-effort: a summary that fails to persist is recomputed next
          // turn, which is the old behaviour rather than a new failure.
          void this.persistInterviewSummary(session, boundarySeq, summary);
        }
      }
      if (!summary) return this.rebuildAnthropicHistory(history);

      const receipts = this.renderEarlierReceipts(history.slice(0, boundary));
      return [
        {
          role: 'user',
          content:
            `<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>` +
            (receipts ? `\n\n${receipts}` : ''),
        },
        ...this.rebuildAnthropicHistory(history.slice(boundary)),
      ];
    } catch (error) {
      this.logger.warn(
        `Could not summarise the interview history for ${session.id}; replaying it in full: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.rebuildAnthropicHistory(history);
    }
  }

  /**
   * What each summarised turn did, from the server's record rather than the
   * summariser's reading of it.
   *
   * The summary is a model's digest of prose, and past forty messages it was
   * the only record of the early turns — so a lookup that failed, or an edit
   * that never landed, dropped out of what the interview knew about itself.
   * These lines are rebuilt from the stored receipts on every turn (cheap,
   * and deterministic, so nothing a summariser drops can take them with it).
   * Newest last, and capped, because this block is paid for on every turn.
   */
  private renderEarlierReceipts(turns: BuilderMessage[]): string {
    const lines = turns
      .filter((message) => message.role === BuilderMessageRole.ASSISTANT)
      .map((message) => ({
        seq: message.seq,
        receipt: receiptOfStoredTurn(message),
      }))
      .filter(({ receipt }) => !receiptIsEmpty(receipt))
      .map(({ seq, receipt }) => `- #${seq}: ${renderReceiptLine(receipt)}`);
    if (!lines.length) return '';
    const kept: string[] = [];
    let budget = BUILDER_EARLIER_RECEIPTS_MAX_CHARS;
    for (const line of [...lines].reverse()) {
      if (line.length > budget) break;
      kept.unshift(line);
      budget -= line.length + 1;
    }
    const omitted = lines.length - kept.length;
    return [
      '<earlier_receipts>',
      'What each summarised turn read, changed and what failed — the system record, not ' +
        'your notes. A failure listed here was never repaired unless a later turn says so.',
      ...(omitted ? [`(${omitted} older turn(s) omitted)`] : []),
      ...kept,
      '</earlier_receipts>',
    ].join('\n');
  }

  /**
   * Remember a summary against the boundary it covers.
   *
   * Keyed by the seq of the last summarised message, so a summary is reused
   * only while the boundary has not moved — and the boundary only moves when
   * enough new turns arrive to push it, at which point the digest genuinely
   * needs redoing.
   */
  private async persistInterviewSummary(
    session: BuilderSession,
    uptoSeq: number,
    text: string,
  ): Promise<void> {
    try {
      const metadata = {
        ...((session.metadata ?? {}) as Record<string, any>),
        interviewSummary: { uptoSeq, text },
      };
      session.metadata = metadata;
      await this.sessionRepository.update(
        { id: session.id },
        // `metadata` is jsonb, which TypeORM's DeepPartial reads as an
        // entity-shaped object unless it is widened — the same treatment
        // `builder_build_runs.cost` needs.
        { metadata: metadata as Record<string, any> },
      );
    } catch (error) {
      this.logger.warn(
        `Could not store the interview summary for ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * A cheap-model digest of the turns being dropped from the replay.
   *
   * Routed through `LlmCompletionService` rather than the agent factory: this
   * is one non-streaming completion with no tools, which is exactly what that
   * service is for — and it brings the registry's model resolution, per-task
   * usage attribution and tier fallback with it. A digest is also the one call
   * here that is fine to lose: `replayHistory` falls back to the full replay
   * when it returns null, so a dead provider costs tokens, not the turn.
   */
  private async summariseTurns(
    session: BuilderSession,
    turns: BuilderMessage[],
  ): Promise<string | null> {
    const rendered = turns
      .map((message) => {
        if (message.role === BuilderMessageRole.USER) {
          return `Admin: ${(message.content ?? '').slice(0, 2_000)}`;
        }
        // The receipt rides with the prose so the digest can keep a failure
        // or an edit that did not land — the prose alone may claim otherwise.
        const receipt = receiptOfStoredTurn(message);
        return [
          `You: ${(message.content ?? '').slice(0, 2_000)}`,
          receiptIsEmpty(receipt)
            ? ''
            : `[receipt: ${renderReceiptLine(receipt).slice(0, 1_000)}]`,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .filter((line) => line.length > 8)
      .join('\n\n');
    if (!rendered) return null;

    const result = await this.llmCompletion.complete({
      taskId: BUILDER_AI_TASKS.INTERVIEW_SUMMARY,
      task: LlmTask.BUILDER_INTERVIEW_SUMMARY,
      system:
        'You compress the earlier part of a requirements interview so it can ' +
        'be dropped from the replayed transcript without losing what it ' +
        'settled. Keep: decisions made and the reason for each, options that ' +
        'were considered and rejected, constraints and preferences the admin ' +
        'stated, and anything still open — including every failure a [receipt] ' +
        'line records that no later turn repaired. Drop: pleasantries, restatements, ' +
        'and anything already written into the PRD — the agent reads that ' +
        'separately and in full. Write it as notes to yourself, not prose.',
      prompt: rendered,
      maxTokens: 1_500,
      model: this.configService.builder.mechanicalModel,
      usageMetadata: { builderSessionId: session.id, turns: turns.length },
    });

    return result.text.trim() || null;
  }

  private rebuildAnthropicHistory(history: BuilderMessage[]): any[] {
    const messages: any[] = [];
    for (const [index, message] of history.entries()) {
      if (message.role === BuilderMessageRole.USER) {
        if (message.content) {
          // A discovery sweep answered this message: replay what it found
          // where the model first read it, so the brief's refs (E1…) still
          // mean something on later turns.
          const next = history[index + 1];
          const discovery =
            next?.role === BuilderMessageRole.ASSISTANT
              ? (next.metadata?.discovery as BuilderDiscovery | undefined)
              : undefined;
          messages.push({
            role: 'user',
            content:
              discovery && Array.isArray(discovery.items)
                ? `${renderDiscoveryBlock(discovery)}\n\n${message.content}`
                : message.content,
          });
        }
        continue;
      }

      const blocks: any[] = [];
      if (message.content) {
        blocks.push({ type: 'text', text: message.content });
      }
      const resultsByToolUseId = new Map(
        (message.toolResults ?? []).map((result: any) => [
          result.toolUseId,
          result,
        ]),
      );
      for (const call of message.toolCalls ?? []) {
        // Only replay tool calls we have results for — a dangling tool_use
        // makes the API reject the whole request.
        if (resultsByToolUseId.has((call as any).id)) {
          blocks.push({
            type: 'tool_use',
            id: (call as any).id,
            name: (call as any).name,
            input: (call as any).input ?? {},
          });
        }
      }
      if (blocks.length === 0) {
        continue;
      }
      messages.push({ role: 'assistant', content: blocks });

      const toolResultBlocks = (message.toolCalls ?? [])
        .filter((call: any) => resultsByToolUseId.has(call.id))
        .map((call: any) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(
            (resultsByToolUseId.get(call.id) as any)?.result ?? {},
          ),
        }));
      if (toolResultBlocks.length > 0) {
        messages.push({ role: 'user', content: toolResultBlocks });
      }
    }
    return messages;
  }

  private recordUsage(
    usage: AgentUsage | undefined,
    model: string,
    provider: string,
    sessionId: string,
    iteration: number,
  ): void {
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    void this.llmUsage.record({
      // The provider that actually ran, not a literal. Attributing a Gemini
      // turn to Anthropic makes per-provider cost unreadable, and this row is
      // what the spend dashboards aggregate.
      provider,
      model,
      task: LlmTask.BUILDER_INTERVIEW,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      // Both halves of the cache are recorded, because they are priced
      // differently and cache effectiveness is the main lever on this agent's
      // cost: reads are the saving, writes are what the saving cost to set up.
      // With only one of the two, a twenty-turn interview's real spend is
      // unknowable.
      cachedTokens: usage?.cachedTokens ?? undefined,
      cacheCreationTokens: usage?.cacheCreationTokens ?? undefined,
      metadata: { builderSessionId: sessionId, iteration },
    });
  }
}
