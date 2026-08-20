import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One user's membership of one cohort.
 *
 * MECE is a database guarantee, not a service convention: a partial UNIQUE on
 * `userId` alone (live rows only) means a user can never hold two live
 * memberships. Do not "fix" a unique-violation here by widening that index to
 * (userId, cohortId) — a user in two cohorts would see the union of two
 * restriction sets, which is precisely the non-MECE behaviour this design
 * rejects. The correct handling is what CohortMemberService does: soft-delete
 * the old membership and insert the new one in one transaction.
 *
 * `tenantId` is denormalised from the cohort so a membership can be scoped and
 * counted without joining `tenant_cohorts`.
 */
@Entity('tenant_cohort_members')
@Index(['cohortId'])
export class TenantCohortMember extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cohortId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
