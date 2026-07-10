import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('track_enrollments')
export class TrackEnrollment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid', nullable: true })
  tenantId?: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'int', default: 0 })
  completedItems!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastActivityAt?: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
