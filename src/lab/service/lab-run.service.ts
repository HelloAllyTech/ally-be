import { Injectable, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LLM_MODEL_REGISTRY } from 'src/llm/constants/llm-model-registry.constants';
import { LabRunRepository } from '../repository/lab-run.repository';
import { LabSkillRepository } from '../repository/lab-skill.repository';
import { LabRunAssignmentRepository } from '../repository/lab-eval.repositories';
import { LabRun, LabRunStatus } from '../entity/lab-run.entity';
import { CreateLabRunDto } from '../dto/lab-run.dto';
import { LabListQueryDto } from '../dto/lab-query.dto';
import { estimateCostUsd } from '../constants/lab-pricing.constants';
import { LabRunProducer } from '../producer/lab-run.producer';

/** Text + token usage returned by a provider call. */
interface ModelResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number } | null;
}

/** Generation parameters a skill may pin for its run. */
interface RunOptions {
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string | null;
}

/** Run list item enriched with human-eval assignment counters. */
export type LabRunListItem = LabRun & {
  evalStats: { assigned: number; submitted: number };
};

const RUN_MAX_TOKENS = 2048;
const RUN_TIMEOUT_MS = 90_000;

/** Escape a variable name for safe use inside a RegExp. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class LabRunService {
  private readonly logger = LoggerService.getInstance(LabRunService.name);
  private readonly anthropic: Anthropic;
  private readonly openai: OpenAI;
  /** Fallback model when a skill has no model set (Anthropic). */
  private readonly defaultModel: string;

  constructor(
    private readonly runRepository: LabRunRepository,
    private readonly skillRepository: LabSkillRepository,
    private readonly assignmentRepository: LabRunAssignmentRepository,
    private readonly configService: AppConfigService,
    private readonly runProducer: LabRunProducer,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.anthropic.apiKey,
    });
    this.openai = new OpenAI({ apiKey: this.configService.openai.apiKey });
    this.defaultModel = this.configService.anthropic.autofillModel;
  }

  async list(
    query: LabListQueryDto,
  ): Promise<{ items: LabRunListItem[]; count: number }> {
    const { items, count } = await this.runRepository.list({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    // Per-run assignment counters so the admin runs log can show human-eval
    // progress (n submitted / m assigned) without an extra round-trip.
    const publishedIds = items.filter((r) => r.publishedAt).map((r) => r.id);
    const stats = new Map<string, { assigned: number; submitted: number }>();
    if (publishedIds.length > 0) {
      const rows: { run_id: string; assigned: string; submitted: string }[] =
        await this.assignmentRepository
          .createQueryBuilder('assignment')
          .select('assignment.runId', 'run_id')
          .addSelect('COUNT(*)', 'assigned')
          .addSelect(
            'COUNT(*) FILTER (WHERE assignment.submitted_at IS NOT NULL)',
            'submitted',
          )
          .where('assignment.runId IN (:...ids)', { ids: publishedIds })
          .groupBy('assignment.runId')
          .getRawMany();
      for (const row of rows) {
        stats.set(row.run_id, {
          assigned: Number(row.assigned),
          submitted: Number(row.submitted),
        });
      }
    }

    return {
      items: items.map((run) => ({
        ...run,
        evalStats: stats.get(run.id) ?? { assigned: 0, submitted: 0 },
      })),
      count,
    };
  }

  async getById(id: string): Promise<LabRun> {
    const run = await this.runRepository.findOne({ where: { id } });
    if (!run) {
      throw new NotFoundException(`Run with ID ${id} not found`);
    }
    return run;
  }

  /**
   * Substitute `{{name}}` (whitespace-tolerant) placeholders in the skill's
   * content with the supplied values.
   */
  private resolvePrompt(
    content: string,
    values: { name: string; value: string }[],
  ): string {
    let resolved = content;
    for (const { name, value } of values) {
      const pattern = new RegExp(
        `\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`,
        'g',
      );
      resolved = resolved.replace(pattern, value);
    }
    return resolved;
  }

  /**
   * Execute the prompt on the given model, routing to the right provider SDK
   * by the model's registry entry. AI Lab runs support Anthropic and OpenAI
   * (the providers this runtime can execute); anything else throws. Applies the
   * skill's optional generation params and returns the output plus token usage.
   */
  private async runModel(
    modelId: string,
    prompt: string,
    opts: RunOptions = {},
  ): Promise<ModelResult> {
    const registryEntry = LLM_MODEL_REGISTRY.find((m) => m.model === modelId);
    const provider = registryEntry?.provider ?? 'anthropic';
    // Temperature is only safe on models that support it (reasoning models
    // reject a non-default temperature).
    const temperature =
      opts.temperature != null && registryEntry?.supportsTemperature !== false
        ? opts.temperature
        : undefined;

    if (provider === 'openai') {
      const response = await this.openai.chat.completions.create(
        {
          model: modelId,
          messages: [
            ...(opts.systemPrompt
              ? [{ role: 'system' as const, content: opts.systemPrompt }]
              : []),
            { role: 'user' as const, content: prompt },
          ],
          // max_completion_tokens (not the deprecated max_tokens) so reasoning
          // models accept it too; omitted when the skill sets no cap.
          ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}),
          ...(temperature != null ? { temperature } : {}),
        },
        { timeout: RUN_TIMEOUT_MS },
      );
      return {
        text: response.choices?.[0]?.message?.content ?? '',
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens ?? 0,
              completionTokens: response.usage.completion_tokens ?? 0,
            }
          : null,
      };
    }

    if (provider === 'anthropic') {
      const response = await this.anthropic.messages.create(
        {
          model: modelId,
          max_tokens: opts.maxTokens ?? RUN_MAX_TOKENS,
          ...(opts.systemPrompt ? { system: opts.systemPrompt } : {}),
          ...(temperature != null ? { temperature } : {}),
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: RUN_TIMEOUT_MS },
      );
      const block = response.content[0];
      return {
        text: block?.type === 'text' ? block.text : '',
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens ?? 0,
              completionTokens: response.usage.output_tokens ?? 0,
            }
          : null,
      };
    }

    throw new Error(
      `AI Lab runs do not support the "${provider}" provider (model ${modelId})`,
    );
  }

  /**
   * Create a run for a single skill. When the lab-run queue is configured the
   * run is persisted as PENDING and enqueued for async execution (returned
   * immediately so the HTTP request doesn't block on the LLM call); the client
   * polls the runs log for completion. Without a queue it executes inline and
   * returns the terminal (COMPLETED/FAILED) row — the original behavior.
   */
  async create(dto: CreateLabRunDto): Promise<LabRun> {
    const skill = await this.skillRepository.findOne({
      where: { id: dto.skillId },
    });
    if (!skill) {
      throw new NotFoundException(`Skill with ID ${dto.skillId} not found`);
    }

    const values = dto.variableValues ?? [];
    const resolvedPrompt = this.resolvePrompt(skill.content, values);
    const modelId = skill.model || this.defaultModel;
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const async = this.runProducer.isEnabled();

    let run = this.runRepository.create({
      batchId: dto.batchId ?? null,
      skillId: skill.id,
      skillName: skill.name,
      resolvedPrompt,
      variableValues: values.map((v) => ({ name: v.name, value: v.value })),
      model: modelId,
      generationParams: {
        temperature: skill.temperature ?? null,
        maxTokens: skill.maxTokens ?? null,
        systemPrompt: skill.systemPrompt ?? null,
      },
      status: async ? LabRunStatus.PENDING : LabRunStatus.RUNNING,
      createdBy: userId,
    });
    run = await this.runRepository.save(run);

    if (async) {
      const enqueued = await this.runProducer.enqueue(run.id);
      if (enqueued) return run; // client polls for completion
      // Enqueue failed unexpectedly — fall through to synchronous execution.
      run.status = LabRunStatus.RUNNING;
      run = await this.runRepository.save(run);
    }

    // Synchronous path: a failed LLM call is a FAILED row, not a thrown error.
    try {
      return await this.runAndPersist(run);
    } catch (error) {
      run.status = LabRunStatus.FAILED;
      run.error = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AI_LAB] run ${run.id} failed: ${run.error}`);
      return this.runRepository.save(run);
    }
  }

  /**
   * Execute a queued (PENDING) run. Flips it to RUNNING, calls the model, and
   * persists the COMPLETED result. Throws on failure so the SQS consumer can
   * let the message retry / dead-letter (terminal failures are marked FAILED
   * by the DLQ handler via markFailed) — the row is left RUNNING between
   * attempts rather than flapping to FAILED on every transient error.
   */
  async execute(runId: string): Promise<LabRun> {
    const run = await this.getById(runId);
    if (run.status === LabRunStatus.COMPLETED) return run; // idempotent
    run.status = LabRunStatus.RUNNING;
    await this.runRepository.save(run);
    return this.runAndPersist(run);
  }

  /** Mark a run FAILED with a message (used by the DLQ handler). */
  async markFailed(runId: string, message: string): Promise<void> {
    const run = await this.runRepository.findOne({ where: { id: runId } });
    if (!run || run.status === LabRunStatus.COMPLETED) return;
    run.status = LabRunStatus.FAILED;
    run.error = message;
    await this.runRepository.save(run);
  }

  /**
   * Core execution: call the run's model with its snapshotted prompt/params,
   * record output + token usage + estimated cost, and persist as COMPLETED.
   * Rethrows provider errors (the caller decides how to record failure).
   */
  private async runAndPersist(run: LabRun): Promise<LabRun> {
    const params = run.generationParams ?? {};
    const result = await this.runModel(run.model, run.resolvedPrompt, {
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      systemPrompt: params.systemPrompt,
    });
    run.output = result.text;
    if (result.usage) {
      run.promptTokens = result.usage.promptTokens;
      run.completionTokens = result.usage.completionTokens;
      run.totalTokens =
        result.usage.promptTokens + result.usage.completionTokens;
      run.costUsd = estimateCostUsd(
        run.model,
        result.usage.promptTokens,
        result.usage.completionTokens,
      );
    }
    run.status = LabRunStatus.COMPLETED;
    this.logger.info(
      `[AI_LAB] run ${run.id} completed (skill=${run.skillId}, model=${run.model})`,
    );
    return this.runRepository.save(run);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    await this.getById(id);
    await this.runRepository.delete(id);
    this.logger.info(`Lab run deleted: ${id}`);
    return { success: true };
  }
}
