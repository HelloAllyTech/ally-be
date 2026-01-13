import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  BadgeStatus,
  BadgeVisibilityType,
  BadgeAchievementCriteria,
} from '../constants/badge.constants';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('badges')
export class Badge extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  imageUrl?: string;

  @Column({ default: BadgeStatus.ACTIVE })
  status!: BadgeStatus;

  @Column({ default: BadgeVisibilityType.PUBLIC })
  visibilityType!: BadgeVisibilityType;

  @Column({ type: 'jsonb', nullable: true })
  achievementCriteria?: BadgeAchievementCriteria;

  @DeleteDateColumn()
  deletedAt?: Date;
}
