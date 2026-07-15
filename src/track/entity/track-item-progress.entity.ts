import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { SessionItemStatus } from 'src/common/type/common.type';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackItemProgressMeta } from '../type/track.type';

/**
 * One row per (enrollment, item), all created upfront at enrollment time
 * (first item UNLOCKED, the rest LOCKED). `id` is what
 * scenario_sessions.trackItemProgressId points back at for roleplay items;
 * `caseSessionId` links CASE items to their underlying case session.
 */
@Entity('track_item_progress')
export class TrackItemProgress extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackEnrollmentId!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  @Column()
  userId!: number;

  @Column({ enum: SessionItemStatus, default: SessionItemStatus.LOCKED })
  status!: SessionItemStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ type: 'numeric', nullable: true })
  score?: number;

  @Column({ type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ type: 'uuid', nullable: true })
  caseSessionId?: string;

  @Column({ type: 'jsonb', nullable: true })
  meta?: TrackItemProgressMeta;

  @DeleteDateColumn()
  deletedAt?: Date;
}
