import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';

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

  @Column({ type: 'text', array: true })
  instructions!: string[];

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;
}
