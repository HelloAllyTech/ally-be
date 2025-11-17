import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';
import { PreferenceValue } from '../../common/type/common.type';
import { PreferenceName } from '../../common/constants/user.constants';

@Entity()
export class Preference extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: PreferenceName;

  @Index('idx_preference_related_entity_id')
  @Column()
  relatedId!: string;

  @Column()
  relatedEntity!: string;

  @Column({ type: 'jsonb' })
  value!: PreferenceValue;
}
