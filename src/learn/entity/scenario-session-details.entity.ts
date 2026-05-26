import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('scenario_session_details_scenario_session_id_idx', [
  'scenarioSessionId',
])
@Entity('scenario_session_details')
export class ScenarioSessionDetails extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int', nullable: true })
  callDuration?: number; // in seconds

  @Column({ type: 'jsonb', nullable: true })
  summary?: Record<string, any>;
}
