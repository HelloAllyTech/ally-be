import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';

/**
 * One row per bug-hunt sweep (one repo, one trigger). A nightly sweep across
 * five repos is five rows, not one — each repo's fix pipeline runs and fails
 * independently, and a reader asking "did ally-web's run finish" should never
 * have to pick that fact out of a merged multi-repo row.
 *
 * `totalTokenCost` is a denormalised snapshot taken at close time from
 * `llm_usage` (see BugHunterService.closeRun), not the source of truth — the
 * source of truth is `llm_usage` rows tagged `LlmTask.BUG_HUNTER` with
 * `metadata.runId = this.id`. The snapshot exists so the run-history table can
 * render a cost column with one query instead of joining out to the fact
 * table per row.
 */
@Entity('bug_hunt_runs')
export class BugHuntRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ enum: BugHuntTrigger })
  trigger!: BugHuntTrigger;

  @Column({ type: 'text' })
  repo!: string;

  @Column({
    enum: BugHuntRunStatus,
    default: BugHuntRunStatus.RUNNING,
  })
  status!: BugHuntRunStatus;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  foundCount!: number;

  @Column({ type: 'int', default: 0 })
  autoMergedCount!: number;

  @Column({ type: 'int', default: 0 })
  prOpenedCount!: number;

  @Column({ type: 'int', default: 0 })
  dismissedCount!: number;

  /** USD, snapshotted at close from `llm_usage` — see class doc. */
  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  totalTokenCostUsd!: string;

  /**
   * Raw token counts backing `totalTokenCostUsd`, snapshotted the same way and
   * at the same time (migration `1912000000000`, renamed to the table's camelCase
   * convention in `1915000000000`). Nullable: runs closed before
   * this column existed have a cost snapshot but no token breakdown, and are
   * never backfilled — the run-history table just shows "—" for them.
   */
  @Column({ type: 'int', nullable: true })
  totalInputTokens?: number | null;

  @Column({ type: 'int', nullable: true })
  totalOutputTokens?: number | null;

  /** Free-form run context: budget cap, repos-in-scope for a multi-repo trigger, error message on FAILED. */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
