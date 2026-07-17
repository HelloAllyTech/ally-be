import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  ImprovementRunOutcome,
  ImprovementRunStatus,
} from '../enum/improvement-run.enum';

/**
 * One autonomous improvement ("auto-improve") run: rehearse → critique →
 * apply proposals to a scratch version lineage → re-rehearse, up to
 * config.maxRounds, until the configured targets are met. The trainer reviews
 * the best round's version + score trajectory and accepts (best version's
 * spec becomes the draft) or discards. At most one non-terminal run per spec.
 */
@Entity('roleplay_improvement_runs')
@Index('idx_improvement_runs_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
export class ImprovementRun extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  /** Round-0 version — the reference every delta is computed against. */
  @Column({ type: 'uuid' })
  baseVersionId!: string;

  @Column({ enum: ImprovementRunStatus, default: ImprovementRunStatus.RUNNING })
  status!: ImprovementRunStatus;

  @Column({ type: 'varchar', nullable: true })
  outcome?: ImprovementRunOutcome | null;

  // { maxRounds, targets: { minOverall?, minDimensions?,
  //   requireAllTestCasesPass }, agentTestCaseIds, traineeProfiles,
  //   turnsPerProfile, languageId, judgeModel?, cheapIntermediateRounds,
  //   timeoutMinutes, copilotSessionId? (chat the loop narrates into),
  //   autoAcceptOnTargetsMet? (copilot-initiated runs apply the winner
  //   to the draft automatically) }.
  @Column({ type: 'jsonb' })
  config!: Record<string, any>;

  @Column({ type: 'int', default: 0 })
  currentRound!: number;

  /** Best full-scope round's candidate version (set when the loop stops). */
  @Column({ type: 'uuid', nullable: true })
  bestVersionId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  bestRehearsalId?: string | null;

  /** Draft version produced by the accept path. */
  @Column({ type: 'uuid', nullable: true })
  acceptedVersionId?: string | null;

  // errorMessage etc.
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date | null;

  /** Who accepted/discarded (review decisions only). */
  @Column({ type: 'int', nullable: true })
  resolvedBy?: number | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
