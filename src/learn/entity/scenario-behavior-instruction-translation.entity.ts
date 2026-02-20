import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('scenario_behavior_instruction_translations')
@Index(
  'uq_sbi_translations_instruction_id_language_id_idx',
  ['scenarioBehaviorInstructionId', 'languageId'],
  { unique: true },
)
export class ScenarioBehaviorInstructionTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioBehaviorInstructionId!: string;

  @Column()
  languageId!: number;

  @Column({ type: 'text', array: true })
  instructions!: string[];
}
