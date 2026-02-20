import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('behavior_translations')
@Index(
  'uq_behavior_translations_behavior_id_language_id_idx',
  ['behaviorId', 'languageId'],
  { unique: true },
)
export class BehaviorTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  behaviorId!: string;

  @Column()
  languageId!: number;

  @Column()
  name!: string;
}
