import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('dashboard_groups')
@Index(
  'uq_dashboard_groups_dashboard_id_group_id_idx',
  ['dashboardId', 'groupId'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
export class DashboardGroup extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  dashboardId!: string;

  @Column({ type: 'integer' })
  groupId!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
