import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('conversational_guardrails_translations')
@Index(
  'uq_conversational_guard_translations_guard_id_lang_id_idx',
  ['guardrailId', 'languageId'],
  { unique: true },
)
export class ConversationalGuardrailsTranslations extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  guardrailId!: string;

  @Column()
  languageId!: number;

  @Column()
  helperDialogue!: string;

  @Column()
  actorDialogue!: string;
}
