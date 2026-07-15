import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A named, saved filter tuple over the language-eval slice dimensions
 * (FR13/FR16). The row with isPinnedReference = true is the pinned reference
 * experiment all dashboard deltas are read against. Cross-tenant
 * (super-admin surface), hence no tenant column.
 */
@Index('eval_experiments_pinned_idx', ['isPinnedReference'])
@Entity('eval_experiments')
export class EvalExperiment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  /** {language?, scenarioVersionId?, promptVersion?, llmModel?} */
  @Column({ type: 'jsonb', default: {} })
  filters!: Record<string, any>;

  @Column({ default: false })
  isPinnedReference!: boolean;

  @Column({ nullable: true })
  createdBy?: number;
}
