import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CopilotRunStatus } from '../enum/copilot-run.enum';
import {
  CopilotRunConfig,
  CopilotRoundHistoryEntry,
} from '../type/copilot-run.type';

/**
 * A Copilot auto-build run: a server-side state machine that generates a
 * roleplay actor's Basic Settings fields, runs a practice conversation +
 * evaluation, and refines until the composite score clears the threshold or
 * the round budget is exhausted.
 */
@Entity('copilot_runs')
@Index('idx_copilot_runs_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
export class CopilotRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ enum: CopilotRunStatus, default: CopilotRunStatus.STARTED })
  status!: CopilotRunStatus;

  @Column({ type: 'text' })
  brief!: string;

  @Column({ type: 'jsonb' })
  config!: CopilotRunConfig;

  /** The transient draft scenario the run builds and evaluates against. */
  @Column({ type: 'int', nullable: true })
  draftScenarioId?: number;

  /** Current round (1-based). */
  @Column({ type: 'int', default: 0 })
  round!: number;

  /** Highest composite score (0-100) seen across rounds so far. */
  @Column({ type: 'int', nullable: true })
  bestScore?: number;

  /** Generated field values that produced bestScore — applied to the form on finish. */
  @Column({ type: 'jsonb', nullable: true })
  bestFieldValues?: Record<string, unknown>;

  /** The in-flight scenario-report id for the round currently being evaluated. */
  @Column({ type: 'uuid', nullable: true })
  currentReportId?: string;

  /** Per-round history for the transparency UI + refinement feedback. */
  @Column({ type: 'jsonb', nullable: true })
  roundHistory?: CopilotRoundHistoryEntry[];

  /** Latest generated field values (the working set for the next refinement). */
  @Column({ type: 'jsonb', nullable: true })
  fieldValues?: Record<string, unknown>;

  /** Human-readable failure reason (when status=FAILED). */
  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;
}
