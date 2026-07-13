import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  ImprovementRoundKind,
  ImprovementRoundStatus,
} from '../enum/improvement-run.enum';

/**
 * One round of an improvement run: rehearse candidateVersionId, then (unless
 * the loop stops) critique + apply proposals into the next round's candidate.
 * `scores` snapshots the rehearsal results summary; `deltas` the comparison
 * vs the previous round and vs the baseline (computed once, at commit time).
 */
@Entity('roleplay_improvement_rounds')
@Index('idx_improvement_rounds_run_id', ['improvementRunId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_improvement_rounds_rehearsal_run_id', ['rehearsalRunId'], {
  where: '"deletedAt" IS NULL',
})
export class ImprovementRound extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  improvementRunId!: string;

  @Column({ type: 'int' })
  roundNumber!: number;

  @Column({ enum: ImprovementRoundKind })
  kind!: ImprovementRoundKind;

  /** The spec version this round rehearses. */
  @Column({ type: 'uuid' })
  candidateVersionId!: string;

  @Column({ type: 'uuid', nullable: true })
  rehearsalRunId?: string | null;

  @Column({
    enum: ImprovementRoundStatus,
    default: ImprovementRoundStatus.REHEARSING,
  })
  status!: ImprovementRoundStatus;

  /** Whether this round rehearsed the full config or a targeted cheap subset. */
  @Column({ type: 'boolean', default: true })
  fullScope!: boolean;

  // Rehearsal results summary: { overall, dimensions, test_counts,
  //   test_pass_rate, test_case_results }.
  @Column({ type: 'jsonb', nullable: true })
  scores?: Record<string, any> | null;

  // { vsPrevious: <comparison|null>, vsBaseline: <comparison|null> } — see
  // RehearsalComparisonService.compare for the comparison shape.
  @Column({ type: 'jsonb', nullable: true })
  deltas?: Record<string, any> | null;

  @Column({ type: 'int', default: 0 })
  proposalsAppliedCount!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
