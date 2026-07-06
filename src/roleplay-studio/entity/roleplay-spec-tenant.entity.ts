import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Spec → tenant visibility (mirrors scenario_tenants). Publish copies these
 * rows into scenario_tenants so learner listing keeps working off the thin
 * scenarios row with zero learner-path changes.
 */
@Entity('roleplay_spec_tenants')
@Index('idx_roleplay_spec_tenants_spec_tenant', ['specId', 'tenantId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class RoleplaySpecTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
