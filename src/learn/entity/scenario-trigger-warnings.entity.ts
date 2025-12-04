import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scenario_trigger_warnings')
@Index(['scenarioId', 'triggerWarningId'], {
  unique: true,
})
export class ScenarioTriggerWarnings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column({ type: 'uuid' })
  triggerWarningId!: string;
}
