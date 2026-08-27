import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import { BuilderExemplarService } from './builder-exemplar.service';
import { BuilderMessageRole } from '../enum/builder.enum';
import { BuilderSessionService } from './builder-session.service';
import { BuilderPrdService } from './builder-prd.service';
import { BuilderKnowledgeService } from './builder-knowledge.service';
import {
  BuilderInterviewToolsService,
  BuilderToolExecutionContext,
} from './builder-interview-tools.service';
import { BuilderSseFrame } from '../type/builder-sse.type';
import { CreateBuilderMessageDto } from '../dto/builder.dto';
import {
  BUILDER_INTERVIEW_MAX_TOKENS,
  BUILDER_INTERVIEW_SUMMARY_AFTER_MESSAGES,
  BUILDER_INTERVIEW_SUMMARY_KEEP_RECENT,
  BUILDER_MAX_TRUNCATION_RETRIES,
  BUILDER_PROMPTS,
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

/** Shown to the admin when a turn overruns the cap past recovering. */
const BUILDER_TRUNCATION_ERROR =
  "That turn ran past the response limit before anything was saved, so the PRD hasn't " +
  'changed. Ask for one section at a time — "write the requirements only" — and it will fit.';

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
  private readonly logger = LoggerService.getInstance(
    BuilderInterviewOrchestratorService.name,
  );

  // Exposed for tests (mocked with a fake client).
  protected client: Anthropic;

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
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * One streamed interview turn. Persists the admin's message up front, then
   * allocates the assistant row and checkpoints it after every model pass and
   * every tool, so an interrupted turn keeps whatever it had already done.
   * Yields SSE frames throughout.
   */
  async *streamTurn(
    sessionId: string,
    dto: CreateBuilderMessageDto,
    userId: number,
  ): AsyncGenerator<BuilderSseFrame> {
    const session = await this.sessionService.getSession(sessionId, userId);
    const doc = await this.prdService.getOrCreateDoc(
      sessionId,
      userId,
      session.title,
    );
    const model = this.configService.builder.interviewModel;
    const maxIterations = Math.max(
      1,
      Number(this.configService.builder.maxToolIterations) || 16,
    );

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
    const system = await this.buildSystemBlocks(
      session.repos ?? undefined,
      exemplars,
    );
    const messages: any[] = [
      ...(await this.replayHistory(session, history)),
      { role: 'user', content: this.buildLiveUserTurn(doc.draft, userContent) },
    ];
    const tools = this.toolsService.getToolDefinitions();

    const context: BuilderToolExecutionContext = { session, doc, userId };

    const textParts: string[] = [];
    const allToolCalls: Record<string, any>[] = [];
    const allToolResults: Record<string, any>[] = [];
    const questions: Record<string, any>[] = [];
    let iterations = 0;
    let stopReason: string | null = null;
    let turnErrored = false;
    let turnError: string | null = null;
    let truncations = 0;

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
          content: textParts.join('\n\n') || null,
          toolCalls: allToolCalls.length > 0 ? [...allToolCalls] : null,
          toolResults: allToolResults.length > 0 ? [...allToolResults] : null,
          metadata: {
            model,
            iterations,
            stopReason,
            errored: turnErrored,
            // Persisted, not just streamed: an `error` frame only reaches the
            // tab that was open when it happened. Without the message on the
            // row, a reload renders a failed turn as no turn at all — the
            // admin sees their own message answered by silence.
            ...(turnError ? { errorMessage: turnError } : {}),
            streaming: !final,
            ...(questions.length > 0 ? { questions: [...questions] } : {}),
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

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        iterations = iteration + 1;

        const stream = this.client.messages.stream({
          model,
          max_tokens: BUILDER_INTERVIEW_MAX_TOKENS,
          system,
          messages,
          tools,
        });

        for await (const event of stream as AsyncIterable<any>) {
          if (
            event?.type === 'content_block_delta' &&
            event?.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            yield { event: 'token', data: { delta: event.delta.text } };
          }
        }

        const finalMessage: any = await (stream as any).finalMessage();
        stopReason = finalMessage?.stop_reason ?? null;
        this.recordUsage(finalMessage?.usage, model, sessionId, iterations);

        const contentBlocks: any[] = finalMessage?.content ?? [];
        for (const block of contentBlocks) {
          if (block?.type === 'text' && block.text) {
            textParts.push(block.text);
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
        if (stopReason === 'max_tokens') {
          truncations += 1;
          if (truncations > BUILDER_MAX_TRUNCATION_RETRIES) {
            this.logger.error(
              `Builder session ${sessionId}: model output still truncated at ` +
                `${BUILDER_INTERVIEW_MAX_TOKENS} tokens after ` +
                `${BUILDER_MAX_TRUNCATION_RETRIES} retries; ending the turn.`,
            );
            turnErrored = true;
            turnError = BUILDER_TRUNCATION_ERROR;
            yield {
              event: 'error',
              data: {
                code: 'response_truncated',
                message: BUILDER_TRUNCATION_ERROR,
              },
            };
            break;
          }

          this.logger.warn(
            `Builder session ${sessionId}: model output truncated at ` +
              `${BUILDER_INTERVIEW_MAX_TOKENS} tokens ` +
              `(retry ${truncations}/${BUILDER_MAX_TRUNCATION_RETRIES}, ` +
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
          continue;
        }

        if (stopReason !== 'tool_use' || toolUses.length === 0) {
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
          allToolCalls.push({ id: toolUse.id, name, input });

          let outcome;
          try {
            outcome = await this.toolsService.execute(name, input, context);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Builder tool "${name}" failed for session ${sessionId}: ${message}`,
            );
            // Handed back as a result rather than thrown: the model can
            // usually repair a bad call, and a thrown error ends the turn.
            outcome = {
              modelResult: { ok: false, error: 'tool_failed', message },
              summary: `Tool ${name} failed: ${message}`,
            };
          }

          for (const frame of outcome.events ?? []) {
            if (frame.event === 'question') {
              questions.push(frame.data);
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
          stopReason = 'end_turn';
          break;
        }
      }

      // The iteration cap landed on a truncated pass, so the retry above never
      // got to run. Nothing was applied, and the admin is owed the same
      // explanation as the give-up path.
      if (stopReason === 'max_tokens' && !turnErrored) {
        turnErrored = true;
        turnError = BUILDER_TRUNCATION_ERROR;
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
      if (stopReason === 'tool_use') {
        this.logger.warn(
          `Builder session ${sessionId} hit the ${maxIterations}-iteration cap; ` +
            'making a tool-less wrap-up pass.',
        );
        const wrapUpStream = this.client.messages.stream({
          model,
          max_tokens: BUILDER_INTERVIEW_MAX_TOKENS,
          system,
          messages,
        });
        for await (const event of wrapUpStream as AsyncIterable<any>) {
          if (
            event?.type === 'content_block_delta' &&
            event?.delta?.type === 'text_delta' &&
            event.delta.text
          ) {
            yield { event: 'token', data: { delta: event.delta.text } };
          }
        }
        const wrapUpMessage: any = await (wrapUpStream as any).finalMessage();
        this.recordUsage(wrapUpMessage?.usage, model, sessionId, iterations);
        for (const block of wrapUpMessage?.content ?? []) {
          if (block?.type === 'text' && block.text) {
            textParts.push(block.text);
          }
        }
        stopReason = wrapUpMessage?.stop_reason ?? 'end_turn';
      }
    } catch (error) {
      turnErrored = true;
      const message = error instanceof Error ? error.message : String(error);
      turnError = message;
      this.logger.error(
        `Builder interview turn failed for session ${sessionId}: ${message}`,
      );
      yield { event: 'error', data: { code: 'interview_error', message } };
    }

    // Last backstop against a silent turn. Every known way of producing one is
    // handled above, but the shape of the failure — the admin's message sitting
    // there with nothing under it — is indistinguishable from the agent having
    // hung, so anything that still gets here says so rather than settling
    // quietly.
    if (!turnErrored && textParts.length === 0 && allToolCalls.length === 0) {
      turnErrored = true;
      turnError = BUILDER_EMPTY_TURN_ERROR;
      this.logger.warn(
        `Builder session ${sessionId}: turn produced no text and no tool ` +
          `calls (stop reason ${stopReason ?? 'none'}).`,
      );
      yield {
        event: 'error',
        data: { code: 'empty_turn', message: BUILDER_EMPTY_TURN_ERROR },
      };
    }

    // Settle the assistant row even for aborted turns: `streaming` goes false
    // here and nowhere else, so a row still marked open is a turn that died.
    await checkpoint(true);

    // Readiness may have moved during the turn; settle the status before the
    // client reads it off the `done` frame.
    const readiness = this.prdService.computeReadiness(context.doc.draft);
    const sessionStatus = await this.sessionService.syncReadinessStatus(
      session,
      readiness,
    );

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
  private buildLiveUserTurn(draft: unknown, userContent: string): string {
    const readiness = this.prdService.computeReadiness(draft as any);
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
  ): Promise<any[]> {
    const [instructions, context] = await Promise.all([
      this.buildSystemPrompt(),
      this.knowledgeService.buildContextBlock(repos, exemplars),
    ]);
    return [
      {
        type: 'text',
        text: instructions,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: context,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  /**
   * Interviewer system prompt from the prompt registry. A missing prompt
   * (e.g. before the first sync) degrades to a minimal built-in instruction
   * rather than failing the turn.
   */
  private async buildSystemPrompt(): Promise<string> {
    try {
      const template = await this.promptSharedService.getPromptByCode(
        BUILDER_PROMPTS.INTERVIEWER_SYSTEM,
      );
      if (template) {
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

      const summary = await this.summariseTurns(
        session,
        history.slice(0, boundary),
      );
      if (!summary) return this.rebuildAnthropicHistory(history);

      return [
        {
          role: 'user',
          content: `<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>`,
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

  /** A cheap-model digest of the turns being dropped from the replay. */
  private async summariseTurns(
    session: BuilderSession,
    turns: BuilderMessage[],
  ): Promise<string | null> {
    const model = this.configService.builder.mechanicalModel;
    const rendered = turns
      .map((message) => {
        const who = message.role === BuilderMessageRole.USER ? 'Admin' : 'You';
        return `${who}: ${(message.content ?? '').slice(0, 2_000)}`;
      })
      .filter((line) => line.length > 8)
      .join('\n\n');
    if (!rendered) return null;

    const response = await this.client.messages.create({
      model,
      max_tokens: 1_500,
      system:
        'You compress the earlier part of a requirements interview so it can ' +
        'be dropped from the replayed transcript without losing what it ' +
        'settled. Keep: decisions made and the reason for each, options that ' +
        'were considered and rejected, constraints and preferences the admin ' +
        'stated, and anything still open. Drop: pleasantries, restatements, ' +
        'and anything already written into the PRD — the agent reads that ' +
        'separately and in full. Write it as notes to yourself, not prose.',
      messages: [{ role: 'user', content: rendered }],
    });

    const input = response.usage?.input_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
      model,
      task: LlmTask.BUILDER_INTERVIEW_SUMMARY,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      metadata: { builderSessionId: session.id, turns: turns.length },
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim();
    return text || null;
  }

  private rebuildAnthropicHistory(history: BuilderMessage[]): any[] {
    const messages: any[] = [];
    for (const message of history) {
      if (message.role === BuilderMessageRole.USER) {
        if (message.content) {
          messages.push({ role: 'user', content: message.content });
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
    usage: Anthropic.Messages.Usage | undefined,
    model: string,
    sessionId: string,
    iteration: number,
  ): void {
    const input = usage?.input_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    void this.llmUsage.record({
      provider: 'anthropic',
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
      cachedTokens: usage?.cache_read_input_tokens ?? undefined,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? undefined,
      metadata: { builderSessionId: sessionId, iteration },
    });
  }
}
