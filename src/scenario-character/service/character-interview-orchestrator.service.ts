import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
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

/** Shown to the admin when a turn came back with nothing in it at all. */
const CHARACTER_INTERVIEW_EMPTY_TURN_ERROR =
  'That turn came back empty — nothing was written and nothing was asked. ' +
  'Send your message again.';

/**
 * The interview turn loop (modeled on CopilotOrchestratorService): stream an
 * Anthropic response, execute tool calls through
 * CharacterInterviewToolsService, feed results back, repeat — capped at
 * config.characterInterview.maxToolIterations round-trips per turn.
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

  // Exposed for tests (mocked with a fake client).
  protected client: Anthropic;

  constructor(
    private readonly configService: AppConfigService,
    private readonly promptSharedService: PromptSharedService,
    private readonly sessionService: CharacterInterviewSessionService,
    private readonly toolsService: CharacterInterviewToolsService,
    private readonly messageRepository: CharacterInterviewMessageRepository,
    private readonly llmUsage: LlmUsageService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

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
    const model = this.configService.characterInterview.model;
    const maxIterations = Math.max(
      1,
      Number(this.configService.characterInterview.maxToolIterations) || 8,
    );

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
    const messages: any[] = [
      ...this.rebuildAnthropicHistory(history),
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

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        iterations = iteration + 1;

        const stream = this.client.messages.stream({
          model,
          max_tokens: CHARACTER_INTERVIEW_MAX_TOKENS,
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
            (block) => block?.type === 'text' && block.text,
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
              `Interview tool "${name}" failed for session ${sessionId}: ${message}`,
            );
            outcome = {
              modelResult: { ok: false, error: 'tool_failed', message },
              summary: `Tool ${name} failed: ${message}`,
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

      // We exhausted the round-trip budget while the model still wanted
      // tools. Make one final tool-less pass so the agent wraps up in prose
      // instead of dying with a raw error.
      if (stopReason === 'tool_use') {
        this.logger.warn(
          `Interview session ${sessionId} hit the ${maxIterations}-iteration ` +
            'cap; making a tool-less wrap-up pass.',
        );
        const wrapUpStream = this.client.messages.stream({
          model,
          max_tokens: CHARACTER_INTERVIEW_MAX_TOKENS,
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
        `Interview turn failed for session ${sessionId}: ${message}`,
      );
      yield {
        event: 'error',
        data: { code: 'interview_error', message },
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
   * Rebuild the Anthropic messages array from persisted rows: assistant rows
   * contribute their text + tool_use blocks, followed by a user turn carrying
   * the recorded tool_result blocks (Anthropic requires every tool_use to be
   * answered before the next real user message).
   */
  private rebuildAnthropicHistory(history: CharacterInterviewMessage[]): any[] {
    const messages: any[] = [];
    for (const message of history) {
      if (message.role === CharacterInterviewMessageRole.USER) {
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
      task: LlmTask.CHARACTER_INTERVIEW,
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
      cachedTokens: usage?.cache_read_input_tokens ?? undefined,
      metadata: { characterInterviewSessionId: sessionId, iteration },
    });
  }
}
