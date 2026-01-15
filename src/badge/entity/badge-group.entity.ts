import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('badge_groups')
@Index('uq_badge_groups_group_id_badge_id_idx', ['groupId', 'badgeId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class BadgeGroup extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  badgeId!: string;

  @Column({ type: 'integer' })
  groupId!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
