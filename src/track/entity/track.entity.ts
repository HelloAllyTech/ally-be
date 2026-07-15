import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackProgressionMode, TrackStatus } from '../type/track.type';

@Entity('tracks')
export class Track extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ enum: TrackStatus, default: TrackStatus.DRAFT })
  status!: TrackStatus;

  @Column({ default: false })
  isGlobal!: boolean;

  @Column({
    enum: TrackProgressionMode,
    default: TrackProgressionMode.SEQUENTIAL,
  })
  progressionMode!: TrackProgressionMode;

  @Column({ type: 'int', default: 0 })
  totalItems!: number;

  @Column({ type: 'int', nullable: true })
  estimatedDurationMinutes?: number;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
