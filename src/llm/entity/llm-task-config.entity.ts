import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-task model selection, editable by an admin without a deploy.
 *
 * Keyed by AI-task-registry row id (`drift-judge`, `interim-reply`, ...) and
 * NOT by `LlmTask`. `LlmTask` is a usage-analytics label and does not identify
 * a call: 16 registry rows carry no label at all, and `agent_turn` covers four
 * rows — including `interim-reply` and `predictive-filler`, which run a cheap
 * fast model deliberately. Keying on the label would collapse those into one
 * setting and silently retier the live voice path.
 *
 * Every selection column is nullable, meaning "ask the next layer down", the
 * same convention `prompts.model` and `lab_skills.model` already use. The full
 * chain is:
 *
 *   explicit call argument -> prompt row -> THIS ROW -> platform tier -> floor
 *
 * System-wide, no tenant: which model serves a task is a platform decision,
 * and a per-tenant model would make cost and quality per task unreadable.
 */
@Entity('llm_task_configs')
export class LlmTaskConfig extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * AI-task-registry row id this configures. Unique — one row per task.
   *
   * A value here that no longer matches a registry id is orphaned config: it
   * silently stops applying, because resolution starts from the registry and
   * looks sideways at this table. The registry spec asserts the reverse
   * direction so a renamed id is caught in CI rather than in production.
   */
  @Index('idx_llm_task_configs_task_id', { unique: true })
  @Column({ name: 'task_id', type: 'varchar', length: 100 })
  taskId!: string;

  /**
   * Explicit provider for `model`. Null → inferred from the model id, which is
   * usually unambiguous and is what the agent factory already does.
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  provider?: string | null;

  /** Model id from the `llm_models` catalog. Null → the platform tier default. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  model?: string | null;

  /** Sampling temperature. Null → provider default; dropped for models that reject one. */
  @Column({ type: 'double precision', nullable: true })
  temperature?: number | null;

  /**
   * Whether a runtime failure may be retried on the platform tier default.
   *
   * Defaults to true — that is the whole point of the chain, and it is what
   * turns an expired vendor credential into degraded quality rather than a
   * dead feature. It must be switchable OFF per task, because for anything
   * whose output is stored and trended a quiet substitution is worse than a
   * failure: a judge score produced by an unpinned model corrupts a
   * (MODEL, PROMPT_VERSION) series that is only comparable within one pair,
   * and nothing downstream can tell the difference after the fact.
   */
  @Column({ name: 'fallback_enabled', type: 'boolean', default: true })
  fallbackEnabled!: boolean;

  /** Who last changed the selection, for the audit trail on the AI Tasks screen. */
  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null;

  /** Why it was changed. Free text; shown next to the value it explains. */
  @Column({ type: 'text', nullable: true })
  note?: string | null;
}
