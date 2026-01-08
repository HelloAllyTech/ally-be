import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scenario_trigger_warnings')
@Index(
  'uq_scenario_trigger_warnings_scenario_id_trigger_warning_id_idx',
  ['scenarioId', 'triggerWarningId'],
  {
    unique: true,
  },
)
export class ScenarioTriggerWarnings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({ type: 'uuid' })
  triggerWarningId!: string;
}
