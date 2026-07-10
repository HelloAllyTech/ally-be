import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackSectionUnlockRule } from '../type/track.type';

@Entity('track_sections')
export class TrackSection extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column()
  order!: number;

  @Column({
    enum: TrackSectionUnlockRule,
    default: TrackSectionUnlockRule.SEQUENTIAL,
  })
  unlockRule!: TrackSectionUnlockRule;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
