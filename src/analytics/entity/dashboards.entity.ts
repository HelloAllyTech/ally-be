import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DashboardMetadata } from '../type/dashboard.data.type';
import { AnalyticsTypeEnum } from '../constants/analytics.constants';

@Entity('dashboards')
export class Dashboard extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  externalId!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true, type: 'jsonb' })
  metadata?: DashboardMetadata;

  @Column({ enum: AnalyticsTypeEnum })
  analyticsType!: AnalyticsTypeEnum;

  @DeleteDateColumn()
  deletedAt?: Date;
}
