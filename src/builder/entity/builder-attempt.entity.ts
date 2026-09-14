import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One coding attempt: what was decided, what ran, and what came back.
 *
 * The training set for model selection. See migration 1970100000000 for why
 * this is a table rather than a query over `cost.phases` and `gate_result`
 * events — the short version is that the decision context is destroyed by
 * later PRD edits, so it has to be frozen when the decision is made.
 *
 * The decision *features* live on the run (`size`, `requirementCount`,
 * `repoCount`, `technicalPlanLength`, `effort`), because they are constant for
 * every attempt in a run. What varies per attempt is the arm and its reward,
 * and that is all this holds.
 */
@Entity('builder_attempts')
@Index('idx_builder_attempts_model', ['model', 'createdAt'])
export class BuilderAttempt extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  /** Denormalised so the delayed reward can be joined without walking runs. */
  @Column({ type: 'uuid' })
  sessionId!: string;

  /** 1-based, matching the `code-N` phase key the runner reports. */
  @Column({ type: 'int' })
  attempt!: number;

  /** `code` today. Room for `verify` and `fix` without a second table. */
  @Column({ type: 'varchar', length: 16, default: 'code' })
  phase!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  engine?: string | null;

  /** The arm. */
  @Column({ type: 'varchar', length: 80 })
  model!: string;

  /** Which rung of the size profile's ladder this came from. */
  @Column({ type: 'int', nullable: true })
  ladderIndex?: number | null;

  /** True when this attempt ran on a stronger tier than the one before it. */
  @Column({ type: 'boolean', default: false })
  escalated!: boolean;

  /**
   * The immediate reward. Null means the gate was never reached — the run
   * paused, held on budget or died first — which is not the same as a failure
   * and must not be counted as one.
   */
  @Column({ type: 'boolean', nullable: true })
  gatePassed?: boolean | null;

  /** How much this attempt broke, when it broke something. */
  @Column({ type: 'int', nullable: true })
  newFailureCount?: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  verifyVerdict?: 'pass' | 'fail' | null;

  /**
   * Whether this attempt's diff is the one that shipped.
   *
   * The delayed reward — merged, reverted, fix runs, review comments — belongs
   * to exactly one attempt per run, and crediting it to all of them would pay
   * the cheap tier that failed twice for work the expensive tier finished.
   */
  @Column({ type: 'boolean', default: false })
  producedFinalDiff!: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  @Column({ type: 'int', nullable: true })
  numTurns?: number | null;
}
