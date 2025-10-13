import { Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entities/base-without-tenant.entity';

@Entity('scenario_events')
export class ScenarioEvents extends BaseWithoutTenantEntity {
  @PrimaryColumn()
  scenarioId!: number;

  @PrimaryColumn()
  eventId!: string;
}
