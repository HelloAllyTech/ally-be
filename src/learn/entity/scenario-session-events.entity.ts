import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('scenario_session_events_scenario_session_id_idx', ['scenarioSessionId'])
@Entity('scenario_session_events')
export class ScenarioSessionEvents extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioSessionId!: string;

  @Column()
  eventId!: string;

  @Column({ type: 'timestamp' })
  occurredAt!: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ nullable: true })
  score?: number;

  @Column({ nullable: true })
  emoji?: string;

  @Column({ nullable: true })
  message?: string;
}
