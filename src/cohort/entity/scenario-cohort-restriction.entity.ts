import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Narrows one tenant-assigned scenario to specific cohorts.
 *
 * The absence of rows is the meaningful default: a scenario with no live
 * restriction row for a tenant is visible to every user of that tenant, exactly
 * as it was before cohorts existed. Rows only ever subtract.
 *
 * A NULL `cohortId` targets the "Unassigned" audience — users of the tenant who
 * hold no membership. See the CreateTenantCohorts migration header.
 */
@Entity('scenario_cohort_restrictions')
@Index(['tenantId', 'scenarioId'])
export class ScenarioCohortRestriction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({ type: 'uuid', nullable: true })
  cohortId?: string | null;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
