import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { IsOptional } from 'class-validator';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { BehaviorStateInstruction } from '../type/scenario-behavior-instructions.type';

@Entity('scenario_behavior_instructions')
@Index('idx_scenario_behavior_instructions_scenario_id_idx', ['scenarioId'])
export class ScenarioBehaviorInstruction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({
    enum: BehaviorInstructionCategory,
  })
  category!: BehaviorInstructionCategory;

  @Column({ type: 'jsonb', nullable: true })
  @IsOptional()
  stateInstructions?: BehaviorStateInstruction[];

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;
}
