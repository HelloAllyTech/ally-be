import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';

@Entity('admin_feature_toggles')
@Index(
  'uq_admin_feature_toggles_user_id_feature_key_idx',
  ['userId', 'featureKey'],
  {
    unique: true,
  },
)
export class AdminFeatureToggle extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column()
  featureKey!: string;

  @Column({ default: false })
  enabled!: boolean;

  /** Acting user's id. Null for rows written by the role-collapse migration. */
  @Column({ nullable: true })
  updatedBy?: number;
}
