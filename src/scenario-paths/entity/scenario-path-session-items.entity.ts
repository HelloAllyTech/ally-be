import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  DeleteDateColumn,
} from 'typeorm';
import { SessionItemStatus } from '../type/scenario-path-session-items.type';

@Entity('scenario_path_session_items')
export class ScenarioPathSessionItem extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioPathSessionId!: string;

  @Column()
  userId!: number;

  @Column()
  scenarioPathItemId!: string;

  @Column({
    enum: SessionItemStatus,
    default: SessionItemStatus.IN_PROGRESS,
  })
  status!: SessionItemStatus;

  @Column({ type: 'float', nullable: true })
  duration?: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
