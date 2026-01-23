import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BadgeViewedStatus } from '../constants/badge.constants';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('badge_users')
@Index('uq_badge_user_user_id_badge_id_idx', ['userId', 'badgeId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class BadgeUser extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  badgeId!: string;

  @Column({ default: BadgeViewedStatus.UNVIEWED })
  viewedStatus!: BadgeViewedStatus;

  @DeleteDateColumn()
  deletedAt?: Date;
}
