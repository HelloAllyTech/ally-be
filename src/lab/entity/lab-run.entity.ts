import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum LabRunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * One execution of a single skill with its variables substituted in. A "Run"
 * the user submits may involve several skills; each skill becomes its own
 * `lab_runs` row (one row = one skill execution), as the AI Lab runs log shows
 * them separately. Columns snapshot the skill name, the resolved prompt and the
 * variable values used, so a row stays meaningful even if the skill/variables
 * are later edited or deleted (no FK to `lab_skills`).
 */
@Entity('lab_runs')
export class LabRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Groups the rows created from a single "Run" click (client-supplied). */
  @Index('idx_lab_runs_batch_id')
  @Column({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId?: string | null;

  @Column({ name: 'skill_id', type: 'uuid', nullable: true })
  skillId?: string | null;

  @Column({ name: 'skill_name', type: 'text' })
  skillName!: string;

  /** The skill's system-prompt content after `{{variable}}` substitution. */
  @Column({ name: 'resolved_prompt', type: 'text' })
  resolvedPrompt!: string;

  /** Snapshot of the variable values used: `[{ name, value }]`. */
  @Column({ name: 'variable_values', type: 'jsonb', default: () => "'[]'" })
  variableValues!: { name: string; value: string }[];

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: LabRunStatus.RUNNING,
  })
  status!: LabRunStatus;

  @Column({ type: 'text', nullable: true })
  output?: string | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /** Token usage reported by the provider (null if unavailable). */
  @Column({ name: 'prompt_tokens', type: 'int', nullable: true })
  promptTokens?: number | null;

  @Column({ name: 'completion_tokens', type: 'int', nullable: true })
  completionTokens?: number | null;

  @Column({ name: 'total_tokens', type: 'int', nullable: true })
  totalTokens?: number | null;

  /**
   * Estimated USD cost, derived from token usage and the per-model pricing
   * table at run time. `numeric` maps to string via TypeORM's driver, so this
   * is typed as string|number; read it with Number(...). Null when usage or a
   * price is unavailable.
   */
  @Column({
    name: 'cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  costUsd?: string | number | null;

  /**
   * Set when a super-duper-admin publishes this (COMPLETED) run for human
   * evaluation, together with its eval questions. A run is published at most
   * once; published runs can be assigned to evaluators.
   */
  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
