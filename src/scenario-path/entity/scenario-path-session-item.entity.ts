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

  @Column({ type: 'uuid' })
  scenarioPathSessionId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  scenarioPathItemId!: string;

  @Column({
    enum: SessionItemStatus,
    default: SessionItemStatus.UNLOCKED,
  })
  status!: SessionItemStatus;

  @DeleteDateColumn()
  deletedAt?: Date;
}
