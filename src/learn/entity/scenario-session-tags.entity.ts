import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('uq_scenario_session_tags_label', ['label'], { unique: true })
@Entity('scenario_session_tags')
export class ScenarioSessionTags extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  label!: string;
}
