import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A tenant admin's own grouping of their users — one slice of a MECE partition.
 *
 * Extends BaseWithoutTenantEntity and carries an explicit uuid `tenantId`
 * rather than extending BaseEntity, because BaseEntity's `tenant_id` is a
 * snake-cased *varchar* (it predates tenants having uuid ids). Every join this
 * table takes part in is against uuid columns — `tenants.id`, and the uuid
 * `tenantId` on scenario_tenants / track_tenants / case_tenants — so matching
 * those avoids a cast on the hot path.
 */
@Entity('tenant_cohorts')
@Index(['tenantId'])
export class TenantCohort extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
