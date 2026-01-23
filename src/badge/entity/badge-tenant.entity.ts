import {
  BaseEntity,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('badge_tenants')
@Index('uq_badge_tenant_badge_id_tenant_id_idx', ['badgeId', 'tenantId'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class BadgeTenant extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  badgeId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
