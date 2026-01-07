import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('scenario_events')
@Index(
  'uq_scenario_events_scenario_id_event_id_auto_termination_status_idx',
  ['scenarioId', 'eventId', 'autoTerminationStatus'],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
export class ScenarioEvents extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column()
  eventId!: string;

  @Column({ nullable: true })
  feedbackStatus?: boolean;

  @Column({ nullable: true })
  emoji?: string;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  score?: number;

  @Column({ nullable: true })
  branchingStatus?: boolean;

  @Column({ nullable: true })
  branchInstruction?: string;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ default: false })
  autoTerminationStatus?: boolean;
}
