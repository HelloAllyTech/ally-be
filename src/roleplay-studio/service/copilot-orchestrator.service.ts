import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { renderTemplate } from 'src/learn/util/autofill-shared.util';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { RehearsalRunRepository } from '../repository/rehearsal-run.repository';
import { ImprovementRunRepository } from '../repository/improvement-run.repository';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';
import { RehearsalStatus } from '../enum/rehearsal-status.enum';
import { CopilotSessionService } from './copilot-session.service';
import {
  CopilotToolsService,
  ToolExecutionContext,
} from './copilot-tools.service';
import { RoleplaySpecService } from './roleplay-spec.service';
import { CopilotSseFrame } from '../type/copilot-sse-event.type';
import { CreateCopilotMessageDto } from '../dto/copilot.dto';
import {
  COPILOT_MAX_TOKENS,
  ROLEPLAY_COPILOT_PROMPTS,
} from '../constants/roleplay-studio.constants';

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
    private readonly rehearsalRunRepository: RehearsalRunRepository,
    private readonly improvementRunRepository: ImprovementRunRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly llmUsage: LlmUsageService,
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
    // happens next.
    const userContent = dto.questionId
      ? `[answers question ${dto.questionId}] ${dto.message}`
      : dto.message;
    await this.copilotMessageRepository.appendMessage(sessionId, {
      role: CopilotMessageRole.USER,
      content: userContent,
      metadata: dto.questionId ? { questionId: dto.questionId } : null,
      createdBy: userId,
    });

    const system = await this.buildSystemPrompt(spec.draftSpec, spec.id);
    const messages: any[] = [
      ...this.rebuildAnthropicHistory(history),
      { role: 'user', content: userContent },
    ];
    const tools = this.copilotToolsService.getToolDefinitions();

    const context: ToolExecutionContext = {
      spec,
      userId,
      appliedPatches: [],
      lastSpecVersionId: null,
    };

    // Turn accumulators for the persisted assistant message.
    const textParts: string[] = [];
    const allToolCalls: Record<string, any>[] = [];
    const allToolResults: Record<string, any>[] = [];
    let iterations = 0;
    let stopReason: string | null = null;
    let turnErrored = false;

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

        if (iteration === maxIterations - 1) {
          // Cap reached with the model still asking for tools.
          yield {
            event: 'error',
            data: {
              code: 'max_tool_iterations',
              message: `Tool-use iteration cap (${maxIterations}) reached; turn truncated.`,
            },
          };
        }
      }
    } catch (error) {
      turnErrored = true;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Copilot turn failed for session ${sessionId}: ${message}`,
      );
      yield {
        event: 'error',
        data: { code: 'copilot_error', message },
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
        },
        createdBy: userId,
      });

    yield {
      event: 'done',
      data: {
        messageSeq: assistantMessage.seq,
        specVersionId: context.lastSpecVersionId,
      },
    };
  }

  /**
   * Interviewer system prompt = interviewer_system + inference_pass from the
   * prompt registry, rendered with the current draft. Missing prompts (e.g.
   * before the first sync) degrade to a minimal built-in instruction rather
   * than failing the turn.
   */
  private async buildSystemPrompt(
    draftSpec: Record<string, any>,
    specId: string,
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
    const awareness = await this.buildRehearsalAwarenessNote(specId);
    if (awareness) {
      parts.push(awareness);
    }
    return parts.join('\n\n');
  }

  /**
   * One-line rehearsal/auto-improve context so the copilot proactively
   * reaches for get_rehearsal_findings instead of designing blind. Best
   * effort — a lookup failure must never break a turn.
   */
  private async buildRehearsalAwarenessNote(
    specId: string,
  ): Promise<string | null> {
    try {
      const lines: string[] = [];
      const latest = await this.rehearsalRunRepository
        .createQueryBuilder('run')
        .where('run.specId = :specId', { specId })
        .andWhere('run.status = :status', {
          status: RehearsalStatus.COMPLETED,
        })
        .orderBy('run.createdAt', 'DESC')
        .getOne();
      if (latest?.results) {
        const dimensions = latest.results.dimensions ?? {};
        const counts = latest.results.test_counts ?? {};
        const totalCases =
          (counts.passed ?? 0) +
          (counts.failed ?? 0) +
          (counts.inconclusive ?? 0);
        const testsNote =
          totalCases > 0
            ? `; tests ${counts.passed ?? 0}/${totalCases} passing`
            : '';
        lines.push(
          `Latest rehearsal: overall ${latest.results.overall ?? '?'} ` +
            `(persona ${dimensions.persona_consistency ?? '?'} / disclosure ` +
            `${dimensions.disclosure_discipline ?? '?'} / difficulty ` +
            `${dimensions.difficulty_calibration ?? '?'} / rubric ` +
            `${dimensions.rubric_coverage ?? '?'})${testsNote}. ` +
            'Call get_rehearsal_findings for the evidence before proposing fixes.',
        );
      }
      const awaiting =
        await this.improvementRunRepository.findAwaitingReview(specId);
      if (awaiting) {
        lines.push(
          'An auto-improve run is AWAITING the trainer’s review ' +
            `(outcome ${awaiting.outcome ?? 'unknown'}); they can accept or ` +
            'discard it in the studio. Use get_improvement_run_status for detail.',
        );
      }
      return lines.length > 0
        ? `## Rehearsal context\n${lines.join('\n')}`
        : null;
    } catch (error) {
      this.logger.warn(
        `Rehearsal awareness note failed for spec ${specId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
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
