import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ScenarioSessionMessageType } from '../enum/scenario-session-message.type.enum';

@Index('scenario_session_messages_scenario_session_id_idx', [
  'scenarioSessionId',
])
@Entity('scenario_session_messages')
export class ScenarioSessionMessages extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  senderId!: number;

  @Column({ enum: ScenarioSessionMessageType })
  messageType!: ScenarioSessionMessageType;

  @Column()
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'float', nullable: true })
  startSeconds?: number;

  @Column({ type: 'float', nullable: true })
  endSeconds?: number;
}
