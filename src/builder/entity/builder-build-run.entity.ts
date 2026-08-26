import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderRunMode, BuilderRunStatus } from '../enum/builder.enum';

/**
 * One dispatched coding run. A session has several: the first `build`, then a
 * `resume` for every question the agent paused on, plus any retry.
 *
 * `githubRunId` is nullable for a reason that shapes this whole module:
 * `workflow_dispatch` answers 204 with no run id, so the run is created here
 * first, `dispatchedAt` is stamped from our own clock a beat *before* the
 * POST, and the reconcile pass correlates the two afterwards. Everything
 * about cancel, run links and status settling is eventually consistent as a
 * consequence.
 */
@Entity('builder_build_runs')
@Index('idx_builder_build_runs_session_id', ['sessionId'])
@Index('idx_builder_build_runs_status', ['status'])
export class BuilderBuildRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** 1-based position within the session, for "run 3 of 4" in the UI. */
  @Column({ type: 'int' })
  sequence!: number;

  @Column({ type: 'varchar', length: 10, enum: BuilderRunMode })
  mode!: BuilderRunMode;

  @Column({
    type: 'varchar',
    length: 20,
    enum: BuilderRunStatus,
    default: BuilderRunStatus.QUEUED,
  })
  status!: BuilderRunStatus;

  /** The paused run this one continues, if any. */
  @Column({ type: 'uuid', nullable: true })
  resumeOfRunId?: string | null;

  @Column({ type: 'varchar', length: 40 })
  engine!: string;

  @Column({ type: 'varchar', length: 80 })
  model!: string;

  /** Slug shared by every branch this run pushes (`builder/<slug>`). */
  @Column({ type: 'varchar', length: 80 })
  branchSlug!: string;

  /**
   * `{ repo: branch }` recorded when a run pauses, so the resume run checks
   * out the work-in-progress instead of branching from master again.
   */
  @Column({ type: 'jsonb', nullable: true })
  branches?: Record<string, string> | null;

  @Column({ type: 'bigint', nullable: true })
  githubRunId?: string | null;

  @Column({ type: 'text', nullable: true })
  githubRunUrl?: string | null;

  /** Our clock, stamped just before the dispatch POST — the correlation key. */
  @Column({ type: 'timestamp' })
  dispatchedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  /** Monotonic event counter; the UI polls/streams with `afterSeq`. */
  @Column({ type: 'int', default: 0 })
  lastEventSeq!: number;

  /** Per-model token breakdown as reported by the engine. */
  @Column({ type: 'jsonb', nullable: true })
  cost?: Record<string, any> | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;

  @Column({ type: 'int', nullable: true })
  runnerMinutes?: number | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;

  @Column({ type: 'int', nullable: true })
  cancelledBy?: number | null;
}
