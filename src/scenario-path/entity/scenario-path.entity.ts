import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScenarioPathStatus } from '../type/scenario-paths.type';

@Entity('scenario_paths')
export class ScenarioPath extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  title!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ enum: ScenarioPathStatus, default: ScenarioPathStatus.DRAFT })
  status!: ScenarioPathStatus;

  @Column({ default: false })
  isGlobal!: boolean;

  @Column({ type: 'int', default: 0 })
  totalScenarios!: number;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
