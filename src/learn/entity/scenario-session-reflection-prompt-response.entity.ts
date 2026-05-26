import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(
  'uq_scenario_session_reflection_prompt_response_idx',
  ['scenarioSessionId', 'promptId'],
  {
    unique: true,
  },
)
@Entity('scenario_session_reflection_prompt_response')
export class ScenarioSessionReflectionPromptResponse extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'uuid' })
  promptId!: string;

  @Column({ type: 'text', nullable: true })
  response?: string;
}
