import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One row per AI-service call across the workspace — the fact table behind the
 * super-admin "AI cost by model & task" chart. Despite the table name (kept
 * `llm_usage` for history), this is the UNIFIED AI-usage store covering three
 * services, disambiguated by the `service` column:
 *   - 'llm' → billed on tokens (promptTokens / completionTokens)
 *   - 'stt' → billed on audio duration (audioMs)
 *   - 'tts' → billed on synthesized characters (characters)
 *
 * Fed from in-process ally-be call sites (autofill / translation) via
 * `LlmUsageService.record()`, and the Python services (ally-ai / ally-ai-learn)
 * via the `llm_usage` SQS message (see LlmUsageProcessor).
 *
 * Append-only. The raw quantities are the source of truth; USD cost is derived
 * at read time from per-service pricing tables, never stored.
 *
 * NOTE: this entity deliberately does NOT extend `BaseEntity`. BaseEntity's
 * `tenant_id` is NOT NULL, but most usage events are tenantless (autofill /
 * translation / drift-judge / live agent run outside a tenant request, and
 * these analytics are platform-wide, not tenant-scoped). So `tenantId` is
 * nullable here — a deliberate divergence; don't "fix" it to NOT NULL.
 */
@Index('llm_usage_occurred_at_idx', ['occurredAt'])
@Index('llm_usage_service_idx', ['service'])
@Index('llm_usage_model_idx', ['model'])
@Index('llm_usage_task_idx', ['task'])
@Entity('llm_usage')
export class LlmUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** When the call happened (writer-supplied; falls back to insert time). */
  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  /** AI service: 'llm' | 'stt' | 'tts'. Selects the billing unit + pricing. */
  @Column({ default: 'llm' })
  service!: string;

  /** Billing unit: 'tokens' | 'audio_seconds' | 'characters'. */
  @Column({ default: 'tokens' })
  unit!: string;

  /** Inference provider, e.g. 'openai' | 'anthropic' | 'gemini' | 'deepgram' | 'elevenlabs' | 'sarvam' | 'google' | 'hume'. */
  @Column()
  provider!: string;

  /** Model id (LLM/STT) or voice/model id (TTS), e.g. 'gpt-4o-mini', 'nova-3'. */
  @Column()
  model!: string;

  /** LlmTask value (raw string; 'unknown' for un-mapped sender tasks). */
  @Column()
  task!: string;

  // LLM quantities (service='llm').
  @Column({ type: 'int', default: 0 })
  promptTokens!: number;

  @Column({ type: 'int', default: 0 })
  completionTokens!: number;

  @Column({ type: 'int', default: 0 })
  totalTokens!: number;

  /** Prompt-cache tokens (subset of prompt) when the provider reports them. */
  @Column({ type: 'int', nullable: true })
  cachedTokens?: number;

  /** STT billable audio duration in milliseconds (service='stt'). */
  @Column({ type: 'int', nullable: true })
  audioMs?: number;

  /** TTS billable synthesized characters (service='tts'). */
  @Column({ type: 'int', nullable: true })
  characters?: number;

  @Column({ nullable: true })
  env?: string;

  // Optional correlation/context — all nullable (most tasks have none).
  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;

  @Column({ type: 'uuid', nullable: true })
  scenarioSessionId?: string;

  @Column({ nullable: true })
  roomId?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
