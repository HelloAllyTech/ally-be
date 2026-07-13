import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CritiqueProposalStatus } from '../enum/critique-proposal-status.enum';

/**
 * One rehearsal-critique proposal: a normalized RFC-6902 patch against the
 * critiqued spec version, plus the evidence-grounded rationale and the
 * predicted effect. Rows are the audit trail the iteration loop learns from —
 * proposal history (with statuses) is fed back into later critiques so the
 * model never re-proposes a patch that was rejected or failed verification.
 */
@Entity('roleplay_critique_proposals')
@Index('idx_critique_proposals_rehearsal_run_id', ['rehearsalRunId'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_critique_proposals_improvement_run_id', ['improvementRunId'], {
  where: '"deletedAt" IS NULL',
})
export class CritiqueProposal extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  rehearsalRunId!: string;

  /** The spec version the critique ran against. */
  @Column({ type: 'uuid' })
  specVersionId!: string;

  /** Set when the critique ran inside an auto-improve loop round. */
  @Column({ type: 'uuid', nullable: true })
  improvementRunId?: string | null;

  @Column({ type: 'int', nullable: true })
  roundNumber?: number | null;

  /** Canonical flat RFC-6902 ops (add/replace/remove), already normalized. */
  @Column({ type: 'jsonb' })
  ops!: Record<string, any>[];

  @Column()
  summary!: string;

  @Column({ type: 'text' })
  rationale!: string;

  @Column()
  targetSection!: string;

  // critical | major | minor (unknown model output coerced to minor).
  @Column()
  severity!: string;

  // { dimensions: [{name, direction}], testCases: [{id, expectedVerdict}] } —
  // the prediction the verification pass checks after the next rehearsal.
  @Column({ type: 'jsonb', nullable: true })
  expectedEffect?: Record<string, any> | null;

  @Column({
    enum: CritiqueProposalStatus,
    default: CritiqueProposalStatus.PROPOSED,
  })
  status!: CritiqueProposalStatus;

  /** Spec version that includes this proposal's ops (set on APPLIED+). */
  @Column({ type: 'uuid', nullable: true })
  appliedInVersionId?: string | null;

  // Verification outcome detail: { observed: {...}, verdict, notes }.
  @Column({ type: 'jsonb', nullable: true })
  verification?: Record<string, any> | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
