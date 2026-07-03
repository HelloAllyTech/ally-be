import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scenario_session_message_translations')
@Index(
  'uq_scenario_session_message_translations_message_id_language_id_idx',
  ['scenarioSessionMessageId', 'languageId'],
  { unique: true },
)
export class ScenarioSessionMessageTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioSessionMessageId!: number;

  @Column()
  languageId!: number;

  @Column({ type: 'text' })
  content!: string;
}
