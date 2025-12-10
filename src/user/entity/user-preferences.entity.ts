import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('user_preferences')
@Index('idx_user_preferences_user_id', ['userId'])
export class UserPreferences {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'userId', type: 'int' })
  userId!: number;

  @Column({ type: 'jsonb', default: () => `'{"default_language_id": 1}'` })
  data!: Record<string, any>;

  @Column({
    name: 'createdAt',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    name: 'updatedAt',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;
}
