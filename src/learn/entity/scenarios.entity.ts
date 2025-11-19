import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  PrimaryGeneratedColumn,
  Entity,
  DeleteDateColumn,
} from 'typeorm';
import { ScenarioStatus } from '../enum/scenario.status.enum';

@Entity('scenarios')
export class Scenarios extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: true })
  title?: string;

  @Column({ nullable: true })
  scenario?: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ nullable: true })
  coverVideoUrl?: string;

  @Column({ enum: ScenarioStatus, default: ScenarioStatus.DRAFT })
  status!: ScenarioStatus;

  @Column({ nullable: true })
  prompt?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ default: false })
  isGlobal!: boolean;
}
