import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('scenario_events_translations')
@Index(
  'uq_scenario_events_translations_scenario_id_event_id_lang_id_idx',
  ['scenarioId', 'eventId', 'languageId'],
  {
    unique: true,
  },
)
export class ScenarioEventsTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column()
  eventId!: string;

  @Column()
  languageId!: number;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  branchInstruction?: string;
}
