import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  PrimaryGeneratedColumn,
  Entity,
  DeleteDateColumn,
} from 'typeorm';
import { ScenarioDifficultyLevel, ScenarioStatus } from '../type/scenario.type';

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

  @Column({
    nullable: true,
    enum: ScenarioDifficultyLevel,
    default: ScenarioDifficultyLevel.MEDIUM,
  })
  difficultyLevel?: ScenarioDifficultyLevel;

  @Column({ default: false })
  isPublic!: boolean;

  @Column({ type: 'uuid', nullable: true })
  competencyId?: string;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;
}
