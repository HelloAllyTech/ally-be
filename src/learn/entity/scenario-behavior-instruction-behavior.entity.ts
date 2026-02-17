import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('scenario_behavior_instruction_behaviors')
@Index(
  'uq_scenario_behavior_instruction_behaviors_instruction_id_behavior_id_idx',
  ['scenarioBehaviorInstructionId', 'behaviorId'],
  {
    unique: true,
  },
)
export class ScenarioBehaviorInstructionBehavior extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  behaviorId!: string;

  @Column({ type: 'uuid' })
  scenarioBehaviorInstructionId!: string;
}
