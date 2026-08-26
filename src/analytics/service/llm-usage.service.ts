import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LlmUsage } from '../entity/llm-usage.entity';

export type AiService = 'llm' | 'stt' | 'tts';

export interface RecordLlmUsageParams {
  /** AI service. Defaults to 'llm' for backward compatibility. */
  service?: AiService;
  /** Billing unit; inferred from service when omitted. */
  unit?: string;
  provider: string;
  model: string;
  task: LlmTask | string;
  // LLM (service='llm').
  promptTokens?: number;
  completionTokens?: number;
  /** Defaults to promptTokens + completionTokens when omitted. */
  totalTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  // STT (service='stt') billable audio duration in milliseconds.
  audioMs?: number;
  // TTS (service='tts') billable synthesized characters.
  characters?: number;
  /** When the call happened; defaults to insert time. */
  occurredAt?: Date;
  env?: string;
  /** Defaults to the current request's tenant (ExecutionManager) when omitted. */
  tenantId?: string;
  scenarioSessionId?: string;
  roomId?: string;
  metadata?: Record<string, any>;
}

const UNIT_BY_SERVICE: Record<AiService, string> = {
  llm: 'tokens',
  stt: 'audio_seconds',
  tts: 'characters',
};

/**
 * Persists one LLM token-usage row. The single sink for every call site:
 * in-process ally-be callers (autofill / translation) invoke `record()`
 * directly (fire-and-forget); the SQS `llm_usage` processor invokes it too.
 *
 * `record()` is BEST-EFFORT and NEVER throws — usage recording must not break
 * the user request or fail the SQS message. Callers can `void` the promise.
 */
@Injectable()
export class LlmUsageService {
  private readonly logger = LoggerService.getInstance(LlmUsageService.name);

  constructor(
    @InjectRepository(LlmUsage)
    private readonly repo: Repository<LlmUsage>,
  ) {}

  async record(params: RecordLlmUsageParams): Promise<void> {
    try {
      if (!params.model || !params.task) {
        this.logger.warn(
          `Skipping LLM usage with missing model/task (provider=${params.provider})`,
        );
        return;
      }

      const service: AiService = params.service ?? 'llm';
      const promptTokens = params.promptTokens ?? 0;
      const completionTokens = params.completionTokens ?? 0;

      await this.repo.insert({
        service,
        unit: params.unit ?? UNIT_BY_SERVICE[service],
        provider: params.provider,
        model: params.model,
        task: String(params.task),
        promptTokens,
        completionTokens,
        totalTokens: params.totalTokens ?? promptTokens + completionTokens,
        cachedTokens: params.cachedTokens,
        cacheCreationTokens: params.cacheCreationTokens,
        audioMs: params.audioMs,
        characters: params.characters,
        occurredAt: params.occurredAt ?? new Date(),
        env: params.env,
        tenantId: params.tenantId ?? ExecutionManager.getTenantId(),
        scenarioSessionId: params.scenarioSessionId,
        roomId: params.roomId,
        metadata: params.metadata,
      });
    } catch (error) {
      // Best-effort: swallow so analytics never breaks the caller.
      this.logger.warn(
        `Failed to record LLM usage (best-effort): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
