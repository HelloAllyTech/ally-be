import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum ConsolidationBatchStatus {
  ACTIVE = 'active',
  ROLLED_BACK = 'rolled_back',
}

/** One entry a consolidation run created, addressable for rollback. */
export interface ConsolidationBatchEntry {
  sectionId: string;
  sectionCode: string;
  profileId: string | null;
  entryId: string;
  markdown: string;
  /** True when the run auto-accepted it into the section content. */
  accepted: boolean;
}

/**
 * One consolidation run — the unit of autonomy and of undo. Every entry the
 * run created is recorded here (with whether it was auto-accepted into live
 * content), so a batch that regresses error rate or adherence can be rolled
 * back as a unit: content lines removed, entries flipped to `rejected` (which
 * keeps their annotations consumed — a rolled-back rule is a rejected rule,
 * not a forgotten one).
 */
@Entity('glossary_consolidation_batches')
@Index('idx_glossary_batches_language', ['languageId', 'createdAt'])
export class GlossaryConsolidationBatch extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  languageId!: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: ConsolidationBatchStatus.ACTIVE,
  })
  status!: ConsolidationBatchStatus;

  /** Whether this run published its entries without human review. */
  @Column({ type: 'boolean', default: false })
  autoAccepted!: boolean;

  /** 'manual' (admin button) or 'scheduled' (the consolidation loop). */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  trigger!: string;

  @Column({ type: 'jsonb', nullable: true })
  stats?: {
    annotationsConsidered: number;
    tenants: number;
    proposed: number;
    autoAccepted: number;
    skippedDuplicates: number;
    overlayEntries: number;
  };

  @Column({ type: 'jsonb', default: () => `'[]'` })
  entries!: ConsolidationBatchEntry[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;
}
