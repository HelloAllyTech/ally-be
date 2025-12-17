import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('scenario_translations')
@Index(
  'uq_scenario_translations_scenarioId_languageId_idx',
  ['scenarioId', 'languageId'],
  { unique: true },
)
export class ScenarioTranslations extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  scenarioId!: number;

  @Column()
  languageId!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
