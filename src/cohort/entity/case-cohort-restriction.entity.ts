import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Narrows one tenant-assigned case to specific cohorts.
 *
 * Same subtractive semantics as ScenarioCohortRestriction: no rows means
 * visible to the whole tenant. A NULL `cohortId` targets users in no cohort.
 */
@Entity('case_cohort_restrictions')
@Index(['tenantId', 'caseId'])
export class CaseCohortRestriction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  caseId!: string;

  @Column({ type: 'uuid', nullable: true })
  cohortId?: string | null;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
