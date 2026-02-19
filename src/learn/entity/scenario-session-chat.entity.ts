import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(
  'uq_scenario_session_chats_scenario_session_id_user_id_idx',
  ['scenarioSessionId', 'userId'],
  { unique: true },
)
@Entity('scenario_session_chats')
export class ScenarioSessionChat extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  scenarioSessionId!: string;

  @Column('int')
  userId!: number;

  @Column({ type: 'text', nullable: true })
  summary?: string;
}
