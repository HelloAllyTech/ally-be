import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from './base.entity';
import { PreferenceValue } from '../type/common.type';
import { UserPreference } from '../constants/user.constants';

@Entity()
export class Preference extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: UserPreference;

  @Index('idx_preference_related_entity_id')
  @Column()
  relatedId!: string;

  @Column()
  relatedEntity!: string;

  @Column({ type: 'jsonb' })
  value!: PreferenceValue;
}
