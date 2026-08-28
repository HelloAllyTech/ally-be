import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';
import { CopilotSessionService } from './copilot-session.service';
import {
  CopilotToolsService,
  ToolExecutionContext,
} from './copilot-tools.service';
import { RoleplaySpecService } from './roleplay-spec.service';
import { RoleplayTestRunService } from './roleplay-test-run.service';
import { CopilotSseFrame } from '../type/copilot-sse-event.type';
import { CreateCopilotMessageDto } from '../dto/copilot.dto';
import {
  AUTO_IMPROVE_MESSAGE_TEMPLATE,
  COPILOT_MAX_TOKENS,
  COPILOT_MAX_TRUNCATION_RETRIES,
  ROLEPLAY_COPILOT_PROMPTS,
} from '../constants/roleplay-studio.constants';

/**
 * What the model is told when its own message was cut off at the output cap.
 *
 * The model cannot see the truncation from its side — the transcript it gets
 * back looks like a message it chose to end — so without this it re-sends the
 * same oversized patch and is cut off again. `update_spec` otherwise asks for
 * batched patches, so the instruction has to override that here specifically.
 */
const COPILOT_TRUNCATION_NUDGE =
  'Your previous message hit the output limit and was cut off before it ' +
  'finished. Nothing from it was saved — any tool call it contained was ' +
  'discarded, so the spec is unchanged. Send it again split across several ' +
  'smaller update_spec calls (one section per call) instead of one large ' +
  'patch. Each one lands on its own.';

/** Shown to the trainer when a turn overruns the cap past recovering. */
const COPILOT_TRUNCATION_ERROR =
  "That turn ran past the response limit before anything was saved, so the spec hasn't " +
  'changed. Ask for one part at a time — "just the persona" — and it will fit.';

/** Shown to the trainer when a turn came back with nothing in it at all. */
const COPILOT_EMPTY_TURN_ERROR =
  'That turn came back empty — nothing was changed and nothing was asked. ' +
  'Send your message again.';

/**
 * The copilot turn loop: stream an Anthropic response, execute tool calls
 * through CopilotToolsService, feed results back, repeat — capped at
 * config.roleplayStudio.maxToolIterations round-trips per turn.
 *
 * Emits the FROZEN SSE frames (token / tool_call / tool_result / spec_patch /
 * question / error / done). Spec patches are persisted inside the tool
 * execution itself, so an aborted or errored turn keeps every patch that was
 * already applied; the assistant transcript row is written in a finally-style
 * tail so partial turns still land in copilot_messages.
 */
@Injectable()
export class CopilotOrchestratorService {
  private readonly logger = LoggerService.getInstance(
    CopilotOrchestratorService.name,
  );

  // Exposed for tests (mocked with a fake client).
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly copilotSessionService: CopilotSessionService,
    private readonly copilotToolsService: CopilotToolsService,
    private readonly copilotMessageRepository: CopilotMessageRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly llmUsage: LlmUsageService,
    // Reader for auto-improve turns (one-way dep — the test-run service never
    // calls back into the orchestrator, so no cycle).
    private readonly testRunService: RoleplayTestRunService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * One streamed copilot turn. Persists the user message up front, the
   * assistant message (text + toolCalls + toolResults + specDiff) at the end,
   * and yields SSE frames throughout.
   */
  async *streamTurn(
    sessionId: string,
    dto: CreateCopilotMessageDto,
    userId: number,
  ): AsyncGenerator<CopilotSseFrame> {
    const session = await this.copilotSessionService.getSession(
      sessionId,
      userId,
    );
    const spec = await this.roleplaySpecService.getSpec(session.specId);
    const model = this.configService.roleplayStudio.copilotModel;
    const maxIterations = Math.max(
      1,
      Number(this.configService.roleplayStudio.maxToolIterations) || 8,
    );

    const history =
      await this.copilotMessageRepository.listBySession(sessionId);

    // Persist the trainer's message first — the transcript survives whatever
    // happens next. Auto-improve turns append the full test report rendered
    // server-side (never trusted from the client).
    let userContent = this.renderUserContent(dto);
    if (dto.autoImprove) {
      const injected = await this.buildAutoImproveContent(
        dto.autoImprove.reportId,
        userId,
      );
      userContent = userContent ? `${userContent}\n\n${injected}` : injected;
    }
    const userMetadata =
      dto.questionId || dto.answer || dto.autoImprove
        ? {
            ...(dto.questionId ? { questionId: dto.questionId } : {}),
            ...(dto.answer ? { answer: dto.answer } : {}),
            ...(dto.autoImprove
              ? { autoImprove: { reportId: dto.autoImprove.reportId } }
              : {}),
          }
        : null;
    await this.copilotMessageRepository.appendMessage(sessionId, {
      role: CopilotMessageRole.USER,
      content: userContent,
      metadata: userMetadata,
      createdBy: userId,
    });

    const system = await this.buildSystemPrompt(spec.draftSpec);
    const messages: any[] = [
      ...this.rebuildAnthropicHistory(history),
      { role: 'user', content: userContent },
    ];
    const tools = this.copilotToolsService.getToolDefinitions();

    const context: ToolExecutionContext = {
      spec,
      sessionId,
      userId,
      appliedPatches: [],
      lastSpecVersionId: null,
    };

    // Turn accumulators for the persisted assistant message. Structured
    // card payloads (questions, behaviour reviews) are persisted in the
    // row's metadata so a resumed chat can reconstruct them faithfully.
    const textParts: string[] = [];
    const allToolCalls: Record<string, any>[] = [];
    const allToolResults: Record<string, any>[] = [];
    const questions: Record<string, any>[] = [];
    const behaviourReviews: Record<string, any>[] = [];
    let iterations = 0;
    let stopReason: string | null = null;
    let turnErrored = false;
    let turnError: string | null = null;
    let truncations = 0;

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        iterations = iteration + 1;

        const stream = this.client.messages.stream({
          model,
          max_tokens: COPILOT_MAX_TOKENS,
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
        // A `max_tokens` stop carries whatever text it managed plus, usually,
        // a half-written tool_use whose `input` the SDK reconstructs by
        // partial JSON parse — present, and unusable. Applying it would write
        // an arbitrary fragment of the patch; dropping it silently (which is
        // what this loop used to do) ends the turn with the copilot having
        // announced an edit it never made. Tell the model and let it retry in
        // pieces.
        if (stopReason === 'max_tokens') {
          truncations += 1;
          if (truncations > COPILOT_MAX_TRUNCATION_RETRIES) {
            this.logger.error(
              `Copilot session ${sessionId}: model output still truncated at ` +
                `${COPILOT_MAX_TOKENS} tokens after ` +
                `${COPILOT_MAX_TRUNCATION_RETRIES} retries; ending the turn.`,
            );
            turnErrored = true;
            turnError = COPILOT_TRUNCATION_ERROR;
            yield {
              event: 'error',
              data: {
                code: 'response_truncated',
                message: COPILOT_TRUNCATION_ERROR,
              },
            };
            break;
          }

          this.logger.warn(
            `Copilot session ${sessionId}: model output truncated at ` +
              `${COPILOT_MAX_TOKENS} tokens ` +
              `(retry ${truncations}/${COPILOT_MAX_TRUNCATION_RETRIES}, ` +
              `${toolUses.length} tool call(s) discarded).`,
          );

          // Only the completed text blocks are replayed — a truncated
          // tool_use has no result to pair it with, and the API rejects a
          // dangling one.
          const textBlocks = contentBlocks.filter(
            (block) => block?.type === 'text' && block.text,
          );
          if (textBlocks.length > 0) {
            messages.push({ role: 'assistant', content: textBlocks });
          }
          messages.push({ role: 'user', content: COPILOT_TRUNCATION_NUDGE });
          continue;
        }

        if (stopReason !== 'tool_use' || toolUses.length === 0) {
          break;
        }

        // Feed the assistant turn (with its tool_use blocks) back verbatim.
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
            outcome = await this.copilotToolsService.execute(
              name,
              input,
              context,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Copilot tool "${name}" failed for session ${sessionId}: ${message}`,
            );
            outcome = {
              modelResult: { ok: false, error: 'tool_failed', message },
              summary: `Tool ${name} failed: ${message}`,
            };
          }

          for (const frame of outcome.events ?? []) {
            if (frame.event === 'question') {
              questions.push(frame.data);
            } else if (frame.event === 'behaviour_review') {
              behaviourReviews.push(frame.data);
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
      // got to run. Nothing was applied, and the trainer is owed the same
      // explanation as the give-up path.
      if (stopReason === 'max_tokens' && !turnErrored) {
        turnErrored = true;
        turnError = COPILOT_TRUNCATION_ERROR;
        yield {
          event: 'error',
          data: {
            code: 'response_truncated',
            message: COPILOT_TRUNCATION_ERROR,
          },
        };
      }

      // We exhausted the round-trip budget while the model still wanted tools.
      // Instead of dying with a raw error, make one final tool-less pass so the
      // copilot summarizes what it changed and what's left — the trainer can
      // reply "continue" to pick up (applied patches are already persisted).
      if (stopReason === 'tool_use') {
        this.logger.warn(
          `Copilot session ${sessionId} hit the ${maxIterations}-iteration ` +
            'cap; making a tool-less wrap-up pass.',
        );
        const wrapUpStream = this.client.messages.stream({
          model,
          max_tokens: COPILOT_MAX_TOKENS,
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

        // The wrap-up pass has no retry budget behind it — if it is itself
        // cut off, the partial text it produced is not a complete answer and
        // must not be persisted as one.
        if (stopReason === 'max_tokens') {
          turnErrored = true;
          turnError = COPILOT_TRUNCATION_ERROR;
          yield {
            event: 'error',
            data: {
              code: 'response_truncated',
              message: COPILOT_TRUNCATION_ERROR,
            },
          };
        }
      }
    } catch (error) {
      turnErrored = true;
      const message = error instanceof Error ? error.message : String(error);
      turnError = message;
      this.logger.error(
        `Copilot turn failed for session ${sessionId}: ${message}`,
      );
      yield {
        event: 'error',
        data: { code: 'copilot_error', message },
      };
    }

    // Last backstop against a silent turn. Every known way of producing one is
    // handled above, but the shape of the failure — the trainer's message with
    // nothing under it — is indistinguishable from the copilot having hung, so
    // anything that still gets here says so rather than settling quietly.
    if (!turnErrored && textParts.length === 0 && allToolCalls.length === 0) {
      turnErrored = true;
      turnError = COPILOT_EMPTY_TURN_ERROR;
      this.logger.warn(
        `Copilot session ${sessionId}: turn produced no text and no tool ` +
          `calls (stop reason ${stopReason ?? 'none'}).`,
      );
      yield {
        event: 'error',
        data: { code: 'empty_turn', message: COPILOT_EMPTY_TURN_ERROR },
      };
    }

    // Persist the assistant message even for aborted turns — applied patches
    // are already durable (written at tool-execution time); this records them
    // against the transcript.
    const assistantMessage: CopilotMessage =
      await this.copilotMessageRepository.appendMessage(sessionId, {
        role: CopilotMessageRole.ASSISTANT,
        content: textParts.join('\n\n') || null,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        specDiff:
          context.appliedPatches.length > 0 ? context.appliedPatches : null,
        metadata: {
          model,
          iterations,
          stopReason,
          errored: turnErrored,
          // Persisted, not just streamed: an `error` frame only reaches the
          // tab that was open when it happened, so without the message on the
          // row a reload renders a failed turn as no turn at all.
          ...(turnError ? { errorMessage: turnError } : {}),
          ...(questions.length > 0 ? { questions } : {}),
          ...(behaviourReviews.length > 0 ? { behaviourReviews } : {}),
        },
        createdBy: userId,
      });

    yield {
      event: 'done',
      data: {
        messageSeq: assistantMessage.seq,
        specVersionId: context.lastSpecVersionId,
        // Fresh concurrency token (context.spec is re-threaded on every
        // persisted patch) so the FE's next draft save doesn't 409.
        updatedAt: context.spec.updatedAt,
      },
    };
  }

  /**
   * Server-side auto-improve injection: fill AUTO_IMPROVE_MESSAGE_TEMPLATE
   * from the test report row (title/type from the stored snapshot, the pinned
   * version's number, the judge's markdown, and the full case snapshot).
   */
  private async buildAutoImproveContent(
    reportId: string,
    userId: number,
  ): Promise<string> {
    const report = await this.testRunService.getReport(reportId, userId);
    const version = await this.roleplaySpecService.getVersionById(
      report.specVersionId,
    );
    return this.fillTemplate(AUTO_IMPROVE_MESSAGE_TEMPLATE, {
      reportId: report.id,
      title: report.testCaseSnapshot?.title ?? 'Untitled test case',
      type: report.testCaseSnapshot?.type ?? 'condition',
      versionNumber: String(version.versionNumber),
      reportMarkdown: report.reportMarkdown ?? '(no report markdown)',
      testCaseSnapshot: JSON.stringify(report.testCaseSnapshot ?? {}),
    });
  }

  /**
   * Deterministic {{token}} fill — replacement callbacks so `$`-sequences in
   * report markdown can't be interpreted as regex replacement patterns.
   */
  private fillTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return Object.entries(variables).reduce(
      (rendered, [key, value]) => rendered.replace(`{{${key}}}`, () => value),
      template,
    );
  }

  /**
   * Build the persisted user-turn content. A structured `answer` (from a
   * multi-select / dropdown / behaviour-review card) is rendered into a
   * deterministic suffix — labels come in via `message`, ids/custom/none via
   * `answer` — so the copilot can act on the exact selections.
   */
  private renderUserContent(dto: CreateCopilotMessageDto): string {
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
    if (answer.helpful?.length) {
      parts.push(`helpful behaviours: ${answer.helpful.join('; ')}`);
    }
    if (answer.unhelpful?.length) {
      parts.push(`unhelpful behaviours: ${answer.unhelpful.join('; ')}`);
    }
    const suffix = parts.length ? ` [${parts.join(' | ')}]` : '';
    return `${prefix}${base}${suffix}`.trim();
  }

  /**
   * Interviewer system prompt = interviewer_system + inference_pass from the
   * prompt registry, rendered with the current draft. Missing prompts (e.g.
   * before the first sync) degrade to a minimal built-in instruction rather
   * than failing the turn.
   */
  private async buildSystemPrompt(
    draftSpec: Record<string, any>,
  ): Promise<string> {
    const variables = {
      currentSpec: JSON.stringify(draftSpec ?? {}, null, 2),
    };
    const parts: string[] = [];
    for (const code of [
      ROLEPLAY_COPILOT_PROMPTS.INTERVIEWER_SYSTEM,
      ROLEPLAY_COPILOT_PROMPTS.INFERENCE_PASS,
    ]) {
      try {
        const template = await this.promptSharedService.getPromptByCode(code);
        if (template) {
          parts.push(renderTemplate(template, variables));
        }
      } catch (error) {
        this.logger.warn(
          `Copilot prompt "${code}" unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (parts.length === 0) {
      parts.push(
        'You are the Roleplay Studio copilot, an expert instructional designer. ' +
          'Interview the trainer one question at a time (ask_trainer) and build the ' +
          'roleplay spec incrementally with update_spec.\n\nCurrent draft spec:\n' +
          variables.currentSpec,
      );
    }
    return parts.join('\n\n');
  }

  /**
   * Rebuild the Anthropic messages array from persisted copilot_messages:
   * assistant rows contribute their text + tool_use blocks, followed by a
   * user turn carrying the recorded tool_result blocks (Anthropic requires
   * every tool_use to be answered before the next real user message).
   */
  private rebuildAnthropicHistory(history: CopilotMessage[]): any[] {
    const messages: any[] = [];
    for (const message of history) {
      if (message.role === CopilotMessageRole.USER) {
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
      task: LlmTask.ROLEPLAY_COPILOT,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cache_read_input_tokens ?? undefined,
      metadata: { copilotSessionId: sessionId, iteration },
    });
  }
}
