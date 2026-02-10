import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('dashboard_tenants')
@Index(
  'uq_dashboard_tenants_dashboard_id_tenant_id_idx',
  ['dashboardId', 'tenantId'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
export class DashboardTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  dashboardId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
