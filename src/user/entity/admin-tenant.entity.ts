import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

@Entity('admin_tenants')
@Index('uq_admin_tenants_user_id_tenant_id_idx', ['userId', 'tenantId'], {
  unique: true,
})
export class AdminTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
