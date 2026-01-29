import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  BadgeStatus,
  BadgeVisibilityType,
  BadgeCategory,
} from '../constants/badge.constants';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BadgeAchievementParams } from '../type/badge.type';

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

  @Column({ enum: BadgeVisibilityType, default: BadgeVisibilityType.PUBLIC })
  visibilityType!: BadgeVisibilityType;

  @Column({ enum: BadgeCategory })
  category!: BadgeCategory;

  @Column({ type: 'jsonb', nullable: true })
  achievementParams?: BadgeAchievementParams;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
