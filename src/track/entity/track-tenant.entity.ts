import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('track_tenants')
export class TrackTenant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
