import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../enum/scenario-session-status.enum';

@Index('scenario_sessions_counselor_id_idx', ['counselorId'])
@Entity('scenario_sessions')
export class ScenarioSessions extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  roomId!: string;

  @Column()
  scenarioId!: number;

  @Column()
  counselorId!: number;

  @Column({
    enum: ScenarioSessionStatus,
    default: ScenarioSessionStatus.ACTIVE,
  })
  status!: ScenarioSessionStatus;

  @Column({
    enum: ScenarioSessionEventStatus,
    default: ScenarioSessionEventStatus.IN_PROGRESS,
  })
  eventStatus!: ScenarioSessionEventStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;

  @Column({ type: 'float', nullable: true })
  score?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  scenarioPathSessionItemId?: string;

  @Column({ type: 'uuid', nullable: true })
  caseSessionItemId?: string;
}
