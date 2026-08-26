import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderMessageRepository } from '../repository/builder-message.repository';
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
  BUILDER_MAX_TOKENS,
  BUILDER_PROMPTS,
} from '../constants/builder.constants';

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
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
  }

  /**
   * One streamed interview turn. Persists the admin's message up front, the
   * assistant message at the end, and yields SSE frames throughout.
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

    const system = await this.buildSystemBlocks(session.repos ?? undefined);
    const messages: any[] = [
      ...this.rebuildAnthropicHistory(history),
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

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        iterations = iteration + 1;

        const stream = this.client.messages.stream({
          model,
          max_tokens: BUILDER_MAX_TOKENS,
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

        if (stopReason !== 'tool_use' || toolUses.length === 0) {
          break;
        }

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

      // Budget exhausted while the model still wanted tools: one tool-less
      // pass so the turn ends in prose rather than a raw error.
      if (stopReason === 'tool_use') {
        this.logger.warn(
          `Builder session ${sessionId} hit the ${maxIterations}-iteration cap; ` +
            'making a tool-less wrap-up pass.',
        );
        const wrapUpStream = this.client.messages.stream({
          model,
          max_tokens: BUILDER_MAX_TOKENS,
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
      this.logger.error(
        `Builder interview turn failed for session ${sessionId}: ${message}`,
      );
      yield { event: 'error', data: { code: 'interview_error', message } };
    }

    // Persist the assistant message even for aborted turns.
    const assistantMessage: BuilderMessage =
      await this.messageRepository.appendMessage(sessionId, {
        role: BuilderMessageRole.ASSISTANT,
        content: textParts.join('\n\n') || null,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        metadata: {
          model,
          iterations,
          stopReason,
          errored: turnErrored,
          ...(questions.length > 0 ? { questions } : {}),
        },
        createdBy: userId,
      });

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
  private async buildSystemBlocks(repos?: string[]): Promise<any[]> {
    const [instructions, context] = await Promise.all([
      this.buildSystemPrompt(),
      this.knowledgeService.buildContextBlock(repos),
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
