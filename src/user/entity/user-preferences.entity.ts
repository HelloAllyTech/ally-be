import { BaseEntity } from 'src/common/entity/base.entity';
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('user_preferences')
@Index('uq_user_preferences_user_id_idx', ['userId'], { unique: true })
export class UserPreferences extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'jsonb' })
  data!: Record<string, any>;
}
