import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('conversational_guardrails_translations')
@Index(
  'uq_conversational_guardrails_translations_guardrail_id_language_id_idx',
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

  @Column({ type: 'text' })
  helperDialogue!: string;

  @Column({ type: 'text' })
  actorDialogue!: string;
}
