import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('sscenario_session_behavior_instructions_scenario_session_id_idx', [
  'scenarioSessionId',
])
@Entity('scenario_session_behavior_instructions')
export class ScenarioSessionBehaviorInstructions extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  scenarioBehaviorInstructionId!: string;

  @Column({ type: 'timestamp' })
  occurredAt!: Date;
}
