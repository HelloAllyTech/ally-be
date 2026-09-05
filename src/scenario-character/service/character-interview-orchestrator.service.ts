import { BadRequestException, Injectable } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from 'src/llm-agent/service/agent-llm.factory';
import { IAgentLlmProvider } from 'src/llm-agent/provider/agent-llm-provider.interface';
import {
  AgentProviderFailure,
  classifyAgentProviderError,
  describeAgentProviderError,
} from 'src/llm-agent/util/agent-provider-error.util';
import {
  AgentContentBlock,
  AgentMessage,
  AgentStreamRequest,
  AgentTurnResult,
  AgentUsage,
} from 'src/llm-agent/type/agent-llm.type';
import { CharacterInterviewMessageRepository } from '../repository/character-interview-message.repository';
import { CharacterInterviewMessage } from '../entity/character-interview-message.entity';
import { CharacterInterviewMessageRole } from '../enum/character-interview.enum';
import { CharacterInterviewSessionService } from './character-interview-session.service';
import {
  CharacterInterviewToolsService,
  InterviewToolExecutionContext,
} from './character-interview-tools.service';
import { CharacterInterviewSseFrame } from '../type/character-interview-sse.type';
import { CreateCharacterInterviewMessageDto } from '../dto/character-interview.dto';
import {
  CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES,
  CHARACTER_INTERVIEW_MAX_TOKENS,
  CHARACTER_INTERVIEW_MAX_TRUNCATION_RETRIES,
  CHARACTER_INTERVIEW_PROMPTS,
} from '../constants/character-interview.constants';

/**
 * What the model is told when its own message was cut off at the output cap.
 *
 * The model cannot see the truncation from its side — the transcript it gets
 * back looks like a message it chose to end — so without this it re-sends the
 * same oversized draft and is cut off again. Unlike a patch-based agent it
 * has nothing to split: `save_character_draft` is one submission, so the only
 * available instruction is to write less of it.
 */
const CHARACTER_INTERVIEW_TRUNCATION_NUDGE =
  'Your previous message hit the output limit and was cut off before it ' +
  'finished. Nothing from it was saved — any tool call it contained was ' +
  'discarded, so no character draft exists. Send save_character_draft again, ' +
  'shorter: keep the strongest knowledge sources rather than all of them, and ' +
  'tighten the longest ones. A saved character the admin can edit beats a ' +
  'complete one that never lands.';

/** Shown to the admin when a turn overruns the cap past recovering. */
const CHARACTER_INTERVIEW_TRUNCATION_ERROR =
  'That turn ran past the response limit before anything was saved, so no ' +
  'character was created. Your answers are all still here — ask for the ' +
  'character again and it will be written more concisely.';

/** Shown to the admin when the model kept producing unreadable tool calls. */
const CHARACTER_INTERVIEW_INVALID_TOOL_CALL_ERROR =
  'The model kept returning an action this app could not read, so the turn ' +
  'was abandoned. Your answers are all still here — send your message again. ' +
  'If it keeps happening, ask an administrator to switch the interviewer ' +
  'prompt to a different model.';

/** Shown to the admin when a turn came back with nothing in it at all. */
const CHARACTER_INTERVIEW_EMPTY_TURN_ERROR =
  'That turn came back empty — nothing was written and nothing was asked. ' +
  'Send your message again.';

/**
 * What the admin is told when the provider call itself failed.
 *
 * The vendor's own error text never reaches this screen. A raw SDK payload —
 * `400 {"type":"error","error":{"type":"invalid_request_error","message":"Your
 * credit balance is too low…"}}` is the one that prompted this — is unreadable
 * to the person in front of it, names a vendor the product deliberately does
 * not expose, offers no next step, and puts the platform's billing state in
 * front of a customer's admin. It is also persisted into the transcript, so
 * one leak renders on every reload of that interview until the session is
 * abandoned.
 *
 * These are kept distinct rather than collapsed into one apology because the
 * next step genuinely differs: three of them are "send it again", one needs an
 * administrator, and one cannot be retried at all. The vendor's words still
 * survive in the log, where the person who can act on them is looking.
 */
const CHARACTER_INTERVIEW_PROVIDER_ERRORS: Record<
  AgentProviderFailure,
  string
> = {
  [AgentProviderFailure.QUOTA]:
    'The interview agent has reached its usage limit with the AI service ' +
    'behind it, so the turn could not run. Your answers are all still here. ' +
    'This one needs an administrator — once the limit is lifted or the ' +
    'interviewer prompt is pointed at another model, the interview carries ' +
    'on from where it stopped.',
  [AgentProviderFailure.AUTH]:
    'The interview agent could not sign in to the AI service behind it, so ' +
    'the turn could not run. Your answers are all still here. Ask an ' +
    "administrator to check the interviewer prompt's model setting and this " +
    "environment's API keys.",
  [AgentProviderFailure.RATE_LIMIT]:
    'The AI service behind the interview agent is busy right now, so the ' +
    'turn was dropped. Your answers are all still here — wait a few seconds ' +
    'and send your message again.',
  [AgentProviderFailure.UNAVAILABLE]:
    'The AI service behind the interview agent could not be reached, so the ' +
    'turn was dropped. Your answers are all still here — send your message ' +
    'again in a minute.',
  [AgentProviderFailure.REQUEST_TOO_LARGE]:
    'This interview has grown longer than the model can read in one go, so ' +
    'the turn could not run. Your answers are all still here, but sending ' +
    'again will hit the same limit — ask an administrator to switch the ' +
    'interviewer prompt to a model with more room, or start a fresh ' +
    'interview.',
  [AgentProviderFailure.UNKNOWN]:
    'That turn could not be completed — the AI service behind the interview ' +
    'agent returned something unexpected. Your answers are all still here; ' +
    'send your message again. If it keeps happening, ask an administrator to ' +
    'check the server logs.',
};

/**
 * Stable `code` on the error frame, one per failure kind.
 *
 * The client renders the message rather than branching on these, but a code is
 * what lets it start to (a retry affordance on the transient three, none on
 * the other two) without parsing prose, and it is what makes a failure
 * countable in the logs. `interview_error` is kept for the unrecognised case
 * because that is the code this stream already emitted for every failure.
 */
const CHARACTER_INTERVIEW_PROVIDER_ERROR_CODES: Record<
  AgentProviderFailure,
  string
> = {
  [AgentProviderFailure.QUOTA]: 'provider_quota_exhausted',
  [AgentProviderFailure.AUTH]: 'provider_auth_failed',
  [AgentProviderFailure.RATE_LIMIT]: 'provider_rate_limited',
  [AgentProviderFailure.UNAVAILABLE]: 'provider_unavailable',
  [AgentProviderFailure.REQUEST_TOO_LARGE]: 'request_too_large',
  [AgentProviderFailure.UNKNOWN]: 'interview_error',
};

/** Shown to the admin when the configured model cannot be run at all. */
const CHARACTER_INTERVIEW_MISCONFIGURED_ERROR =
  'The interview agent is not configured correctly on this environment, so ' +
  'the turn could not run. Your answers are all still here. Ask an ' +
  "administrator to check the interviewer prompt's model setting.";

/**
 * The interview turn loop (modeled on CopilotOrchestratorService): stream a
 * model response, execute tool calls through CharacterInterviewToolsService,
 * feed results back, repeat — capped at
 * config.characterInterview.maxToolIterations round-trips per turn.
 *
 * The model can be Anthropic, OpenAI or Gemini: the loop talks to
 * `AgentLlmProviderFactory`, whose adapters translate the one block vocabulary
 * used here (and persisted in `character_interview_messages`) to and from each
 * provider's own. Nothing below branches on which one is running.
 *
 * Emits SSE frames (token / tool_call / tool_result / question /
 * character_draft / error / done). The assistant transcript row is written in
 * a finally-style tail so partial turns still land in
 * character_interview_messages.
 */
@Injectable()
export class CharacterInterviewOrchestratorService {
  private readonly logger = LoggerService.getInstance(
    CharacterInterviewOrchestratorService.name,
  );

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly sessionService: CharacterInterviewSessionService,
    private readonly toolsService: CharacterInterviewToolsService,
    private readonly messageRepository: CharacterInterviewMessageRepository,
    private readonly llmUsage: LlmUsageService,
    private readonly agentLlmFactory: AgentLlmProviderFactory,
  ) {}

  /**
   * One streamed interview turn. Persists the user message up front, the
   * assistant message (text + toolCalls + toolResults) at the end, and yields
   * SSE frames throughout.
   */
  async *streamTurn(
    sessionId: string,
    dto: CreateCharacterInterviewMessageDto,
    userId: number,
  ): AsyncGenerator<CharacterInterviewSseFrame> {
    const session = await this.sessionService.getSession(sessionId, userId);
    const maxIterations = Math.max(
      1,
      Number(this.configService.characterInterview.maxToolIterations) || 8,
    );

    // Resolved before anything is written.
    //
    // Unlike every other failure below this one is not turn-level — the model
    // is misconfigured for the whole environment, so the next turn and the one
    // after fail identically. Persisting the admin's message plus an errored
    // assistant row (what a turn-level failure does, so a reload can show what
    // happened) would just stack identical rows into the transcript until
    // someone fixes the config. Leaving the transcript untouched means the
    // interview is exactly where they left it once it is fixed.
    let provider: IAgentLlmProvider;
    let model: string;
    let providerName: string;
    try {
      const resolved = await this.resolveModel();
      providerName = resolved.provider;
      model = resolved.model;
      provider = this.agentLlmFactory.create(resolved.provider, resolved.model);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Interview session ${sessionId} cannot start a turn: ${detail}`,
      );
      yield {
        event: 'error',
        data: {
          code: 'interview_misconfigured',
          message: `${CHARACTER_INTERVIEW_MISCONFIGURED_ERROR} (${detail})`,
        },
      };
      return;
    }

    const history = await this.messageRepository.listBySession(sessionId);

    // Persist the admin's message first — the transcript survives whatever
    // happens next.
    const userContent = this.renderUserContent(dto);
    const userMetadata =
      dto.questionId || dto.answer
        ? {
            ...(dto.questionId ? { questionId: dto.questionId } : {}),
            ...(dto.answer ? { answer: dto.answer } : {}),
          }
        : null;
    await this.messageRepository.appendMessage(sessionId, {
      role: CharacterInterviewMessageRole.USER,
      content: userContent,
      metadata: userMetadata,
      createdBy: userId,
    });

    const system = await this.buildSystemPrompt();
    const messages: AgentMessage[] = [
      ...this.rebuildHistory(history),
      { role: 'user', content: userContent },
    ];
    const tools = this.toolsService.getToolDefinitions();

    const context: InterviewToolExecutionContext = {
      session,
      userId,
    };

    // Turn accumulators for the persisted assistant message. Question payloads
    // are persisted in the row's metadata so a resumed chat can reconstruct
    // the cards faithfully.
    const textParts: string[] = [];
    const allToolCalls: Record<string, any>[] = [];
    const allToolResults: Record<string, any>[] = [];
    const questions: Record<string, any>[] = [];
    let characterDraft: Record<string, any> | null = null;
    let iterations = 0;
    let stopReason: string | null = null;
    let turnErrored = false;
    let turnError: string | null = null;
    let truncations = 0;
    let invalidToolCalls = 0;

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        iterations = iteration + 1;

        const turn = yield* this.runPass(provider, {
          model,
          maxTokens: CHARACTER_INTERVIEW_MAX_TOKENS,
          system,
          messages,
          tools,
        });

        stopReason = turn.stopReason;
        this.recordUsage(
          turn.usage,
          providerName,
          model,
          sessionId,
          iterations,
        );

        const contentBlocks = turn.content;
        for (const block of contentBlocks) {
          if (block?.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        const toolUses = contentBlocks.filter(
          (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
            block?.type === 'tool_use',
        );

        // The model tried to call a tool and produced something unreadable.
        //
        // The turn comes back empty, so this is the one failure that would
        // otherwise be indistinguishable from the model choosing to say
        // nothing — it would surface as `empty_turn` and lose the turn. There
        // is nothing partial to salvage and nothing to tell the model (it
        // cannot see the malformed call either), so the recovery is to send
        // the identical request again.
        if (stopReason === 'invalid_tool_call') {
          invalidToolCalls += 1;
          if (
            invalidToolCalls > CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES
          ) {
            this.logger.error(
              `Interview session ${sessionId}: ${providerName}/${model} ` +
                'returned an unreadable tool call after ' +
                `${CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES} ` +
                'retries; ending the turn.',
            );
            turnErrored = true;
            turnError = CHARACTER_INTERVIEW_INVALID_TOOL_CALL_ERROR;
            yield {
              event: 'error',
              data: {
                code: 'invalid_tool_call',
                message: CHARACTER_INTERVIEW_INVALID_TOOL_CALL_ERROR,
              },
            };
            break;
          }

          this.logger.warn(
            `Interview session ${sessionId}: ${providerName}/${model} ` +
              'returned an unreadable tool call (retry ' +
              `${invalidToolCalls}/${CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES}).`,
          );
          continue;
        }

        // The model ran out of output room mid-message.
        //
        // A `max_tokens` stop carries whatever text it managed plus, usually,
        // a half-written tool_use whose `input` the SDK reconstructs by
        // partial JSON parse — present, and unusable. Executing it would save
        // an arbitrary fragment of a character; dropping it silently (which is
        // what this loop used to do) ends the turn with the agent having
        // announced a draft it never wrote. Tell the model and let it retry
        // smaller.
        if (stopReason === 'max_tokens') {
          truncations += 1;
          if (truncations > CHARACTER_INTERVIEW_MAX_TRUNCATION_RETRIES) {
            this.logger.error(
              `Interview session ${sessionId}: model output still truncated ` +
                `at ${CHARACTER_INTERVIEW_MAX_TOKENS} tokens after ` +
                `${CHARACTER_INTERVIEW_MAX_TRUNCATION_RETRIES} retries; ` +
                'ending the turn.',
            );
            turnErrored = true;
            turnError = CHARACTER_INTERVIEW_TRUNCATION_ERROR;
            yield {
              event: 'error',
              data: {
                code: 'response_truncated',
                message: CHARACTER_INTERVIEW_TRUNCATION_ERROR,
              },
            };
            break;
          }

          this.logger.warn(
            `Interview session ${sessionId}: model output truncated at ` +
              `${CHARACTER_INTERVIEW_MAX_TOKENS} tokens ` +
              `(retry ${truncations}/${CHARACTER_INTERVIEW_MAX_TRUNCATION_RETRIES}, ` +
              `${toolUses.length} tool call(s) discarded).`,
          );

          // Only the completed text blocks are replayed — a truncated
          // tool_use has no result to pair it with, and the API rejects a
          // dangling one.
          const textBlocks = contentBlocks.filter(
            (block): block is Extract<AgentContentBlock, { type: 'text' }> =>
              block?.type === 'text' && Boolean(block.text),
          );
          if (textBlocks.length > 0) {
            messages.push({ role: 'assistant', content: textBlocks });
          }
          messages.push({
            role: 'user',
            content: CHARACTER_INTERVIEW_TRUNCATION_NUDGE,
          });
          continue;
        }

        if (stopReason !== 'tool_use' || toolUses.length === 0) {
          break;
        }

        // Feed the assistant turn (with its tool_use blocks) back verbatim.
        messages.push({ role: 'assistant', content: contentBlocks });

        const toolResultBlocks: AgentContentBlock[] = [];
        let endTurn = false;

        for (const toolUse of toolUses) {
          const name = String(toolUse.name);
          const input = (toolUse.input ?? {}) as Record<string, any>;
          yield { event: 'tool_call', data: { name, input } };
          allToolCalls.push({ id: toolUse.id, name, input });

          let outcome;
          try {
            outcome = await this.toolsService.execute(name, input, context);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Interview tool "${name}" failed for session ${sessionId}: ${message}`,
            );
            outcome = {
              // The model gets the real reason — it is what lets it retry the
              // call differently — but the summary goes over the wire to the
              // browser, so it carries the tool name and nothing else.
              modelResult: { ok: false, error: 'tool_failed', message },
              summary: `Tool ${name} failed.`,
            };
          }

          for (const frame of outcome.events ?? []) {
            if (frame.event === 'question') {
              questions.push(frame.data);
            } else if (frame.event === 'character_draft') {
              characterDraft = frame.data.draft ?? null;
            }
            yield frame;
          }
          yield {
            event: 'tool_result',
            data: { name, summary: outcome.summary },
          };

          allToolResults.push({
            toolUseId: toolUse.id,
            name,
            result: outcome.modelResult,
          });
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(outcome.modelResult),
          });
          if (outcome.endTurn) {
            endTurn = true;
          }
        }

        messages.push({ role: 'user', content: toolResultBlocks });

        if (endTurn) {
          stopReason = 'end_turn';
          break;
        }
      }

      // The iteration cap landed on a truncated pass, so the retry above never
      // got to run. Nothing was saved, and the admin is owed the same
      // explanation as the give-up path.
      if (stopReason === 'max_tokens' && !turnErrored) {
        turnErrored = true;
        turnError = CHARACTER_INTERVIEW_TRUNCATION_ERROR;
        yield {
          event: 'error',
          data: {
            code: 'response_truncated',
            message: CHARACTER_INTERVIEW_TRUNCATION_ERROR,
          },
        };
      }

      // Same for the iteration cap landing on an unreadable tool call: the
      // retry never ran, and the turn is empty for a reason the admin should
      // be told rather than being reported as the model having nothing to say.
      if (stopReason === 'invalid_tool_call' && !turnErrored) {
        turnErrored = true;
        turnError = CHARACTER_INTERVIEW_INVALID_TOOL_CALL_ERROR;
        yield {
          event: 'error',
          data: {
            code: 'invalid_tool_call',
            message: CHARACTER_INTERVIEW_INVALID_TOOL_CALL_ERROR,
          },
        };
      }

      // We exhausted the round-trip budget while the model still wanted
      // tools. Make one final tool-less pass so the agent wraps up in prose
      // instead of dying with a raw error.
      if (stopReason === 'tool_use') {
        this.logger.warn(
          `Interview session ${sessionId} hit the ${maxIterations}-iteration ` +
            'cap; making a tool-less wrap-up pass.',
        );
        // No `tools` on this pass — that is what makes it a wrap-up.
        const wrapUp = yield* this.runPass(provider, {
          model,
          maxTokens: CHARACTER_INTERVIEW_MAX_TOKENS,
          system,
          messages,
        });
        this.recordUsage(
          wrapUp.usage,
          providerName,
          model,
          sessionId,
          iterations,
        );
        for (const block of wrapUp.content) {
          if (block?.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        stopReason = wrapUp.stopReason;

        // The wrap-up pass has no retry budget behind it — if it is itself
        // cut off, the partial text it produced is not a complete answer and
        // must not be persisted as one.
        if (stopReason === 'max_tokens') {
          turnErrored = true;
          turnError = CHARACTER_INTERVIEW_TRUNCATION_ERROR;
          yield {
            event: 'error',
            data: {
              code: 'response_truncated',
              message: CHARACTER_INTERVIEW_TRUNCATION_ERROR,
            },
          };
        }
      }
    } catch (error) {
      turnErrored = true;
      // Classified rather than relayed: what the provider threw is written to
      // the log, and what the admin is shown is our own copy for that kind of
      // failure. `turnError` is persisted on the assistant row, so this is
      // also what a reload of the interview renders.
      const failure = classifyAgentProviderError(error);
      turnError = CHARACTER_INTERVIEW_PROVIDER_ERRORS[failure];
      this.logger.error(
        `Interview turn failed for session ${sessionId} on ` +
          `${providerName}/${model} (${failure}): ` +
          describeAgentProviderError(error),
      );
      yield {
        event: 'error',
        data: {
          code: CHARACTER_INTERVIEW_PROVIDER_ERROR_CODES[failure],
          message: turnError,
        },
      };
    }

    // Last backstop against a silent turn. Every known way of producing one is
    // handled above, but the shape of the failure — the admin's message with
    // nothing under it — is indistinguishable from the agent having hung, so
    // anything that still gets here says so rather than settling quietly.
    if (!turnErrored && textParts.length === 0 && allToolCalls.length === 0) {
      turnErrored = true;
      turnError = CHARACTER_INTERVIEW_EMPTY_TURN_ERROR;
      this.logger.warn(
        `Interview session ${sessionId}: turn produced no text and no tool ` +
          `calls (stop reason ${stopReason ?? 'none'}).`,
      );
      yield {
        event: 'error',
        data: {
          code: 'empty_turn',
          message: CHARACTER_INTERVIEW_EMPTY_TURN_ERROR,
        },
      };
    }

    // Persist the assistant message even for aborted turns.
    const assistantMessage: CharacterInterviewMessage =
      await this.messageRepository.appendMessage(sessionId, {
        role: CharacterInterviewMessageRole.ASSISTANT,
        content: textParts.join('\n\n') || null,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        metadata: {
          provider: providerName,
          model,
          iterations,
          stopReason,
          errored: turnErrored,
          // Persisted, not just streamed: an `error` frame only reaches the
          // tab that was open when it happened, so without the message on the
          // row a reload renders a failed turn as no turn at all.
          ...(turnError ? { errorMessage: turnError } : {}),
          ...(questions.length > 0 ? { questions } : {}),
          ...(characterDraft ? { characterDraft } : {}),
        },
        createdBy: userId,
      });

    yield {
      event: 'done',
      data: {
        messageSeq: assistantMessage.seq,
        sessionStatus: context.session.status,
      },
    };
  }

  /**
   * One provider round-trip: relay text deltas as `token` frames, return the
   * assembled turn.
   *
   * A generator with a return value so the caller can `yield*` it — the
   * streamed frames belong to the caller's SSE stream, but the finished turn
   * is what the loop actually reasons about.
   */
  private async *runPass(
    provider: IAgentLlmProvider,
    request: AgentStreamRequest,
  ): AsyncGenerator<CharacterInterviewSseFrame, AgentTurnResult> {
    let result: AgentTurnResult | null = null;
    for await (const event of provider.stream(request)) {
      if (event.type === 'text_delta') {
        yield { event: 'token', data: { delta: event.text } };
      } else {
        result = event.message;
      }
    }
    if (!result) {
      // Every adapter ends with a `final`; one that didn't would otherwise
      // read as a normal empty turn and be persisted as one.
      throw new Error(
        `The ${provider.name} model returned no response for this turn.`,
      );
    }
    return result;
  }

  /**
   * Which model runs this turn, and who provides it.
   *
   * The prompt row for the interviewer system prompt wins — that is the knob
   * admins already use to set a provider/model per prompt, and it is the one
   * place where a model change and the prompt retuning it usually needs can be
   * made together. Environment config is the fallback.
   *
   * The provider is inferred from the model id when it isn't stated, so
   * setting a model is normally the whole change.
   */
  private async resolveModel(): Promise<{ provider: string; model: string }> {
    let promptProvider: string | undefined;
    let promptModel: string | undefined;
    try {
      const promptConfig = await this.promptSharedService.getPromptLlmConfig(
        CHARACTER_INTERVIEW_PROMPTS.INTERVIEWER_SYSTEM,
      );
      promptProvider = promptConfig.provider;
      promptModel = promptConfig.model;
    } catch (error) {
      this.logger.warn(
        `Interview prompt LLM config unavailable, using environment config: ${
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
        `Interviewer prompt names model "${promptModel}" with no provider ` +
          'this service can run; falling back to environment config.',
      );
    } else if (promptProvider) {
      // A provider with no model alongside it is half a setting — it cannot be
      // combined with the environment's model, which may belong to a different
      // provider entirely.
      this.logger.warn(
        `Interviewer prompt sets provider "${promptProvider}" but no model; ` +
          'falling back to environment config.',
      );
    }

    const model = this.configService.characterInterview.model;
    const configured = this.configService.characterInterview.provider;
    const resolved =
      normaliseAgentProvider(configured) ?? providerForModel(model);
    if (!resolved) {
      throw new BadRequestException(
        `No provider is known for interview model "${model}". Set ` +
          'CHARACTER_INTERVIEW_PROVIDER, or pick the provider on the ' +
          'interviewer prompt.',
      );
    }
    return { provider: resolved, model };
  }

  /**
   * Build the persisted user-turn content. A structured `answer` (from a
   * select/dropdown card) is rendered into a deterministic suffix — labels
   * come in via `message`, ids/custom/none via `answer` — so the agent can
   * act on the exact selections.
   */
  private renderUserContent(dto: CreateCharacterInterviewMessageDto): string {
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
   * Interviewer system prompt from the prompt registry. A missing prompt
   * (e.g. before the first sync) degrades to a minimal built-in instruction
   * rather than failing the turn.
   */
  private async buildSystemPrompt(): Promise<string> {
    try {
      const template = await this.promptSharedService.getPromptByCode(
        CHARACTER_INTERVIEW_PROMPTS.INTERVIEWER_SYSTEM,
      );
      if (template) {
        return template;
      }
    } catch (error) {
      this.logger.warn(
        `Interview prompt unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return (
      'You are a character-profile interviewer. Ask the admin one question ' +
      'at a time via ask_question (always offering default options plus a ' +
      'custom answer), build a rich and consistent character, then submit it ' +
      'with save_character_draft.'
    );
  }

  /**
   * Rebuild the messages array from persisted rows: assistant rows contribute
   * their text + tool_use blocks, followed by a user turn carrying the
   * recorded tool_result blocks (every tool_use must be answered before the
   * next real user message — all three providers reject a dangling one).
   *
   * The rows are provider-neutral, so a session that started on one model
   * replays intact on another: the ids in it were minted by whoever was
   * running at the time and are treated as opaque from here on.
   */
  private rebuildHistory(history: CharacterInterviewMessage[]): AgentMessage[] {
    const messages: AgentMessage[] = [];
    for (const message of history) {
      if (message.role === CharacterInterviewMessageRole.USER) {
        if (message.content) {
          messages.push({ role: 'user', content: message.content });
        }
        continue;
      }

      const blocks: AgentContentBlock[] = [];
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
        // would make the API reject the whole request.
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

      const toolResultBlocks: AgentContentBlock[] = (message.toolCalls ?? [])
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
    provider: string,
    model: string,
    sessionId: string,
    iteration: number,
  ): void {
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    void this.llmUsage.record({
      provider,
      model,
      task: LlmTask.CHARACTER_INTERVIEW,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cachedTokens ?? undefined,
      metadata: { characterInterviewSessionId: sessionId, iteration },
    });
  }
}
