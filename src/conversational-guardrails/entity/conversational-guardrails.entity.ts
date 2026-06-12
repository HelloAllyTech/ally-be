import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { ConversationalGuardrailKind } from '../enum/conversational-guardrails-kind.enum';
import { ConversationalGuardrailDetectorType } from '../enum/conversational-guardrails-detector-type.enum';

@Entity('conversational_guardrails')
export class ConversationalGuardrails extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ default: '' })
  name!: string;

  @Column()
  helperDialogue!: string;

  @Column()
  actorDialogue!: string;

  @Column({ default: true })
  active!: boolean;

  // USER guardrails are admin-managed and randomly sampled per session.
  // SYSTEM guardrails are platform-provided, always injected, and shown
  // in the admin list with a locked badge.
  @Column({
    type: 'enum',
    enum: ConversationalGuardrailKind,
    enumName: 'conversational_guardrails_kind_enum',
    default: ConversationalGuardrailKind.USER,
  })
  kind!: ConversationalGuardrailKind;

  // Mandatory guardrails cannot be deleted or disabled (their dialogue text
  // remains editable). Used to keep the STT Coherence Guard always on.
  @Column({ default: false })
  mandatory!: boolean;

  // Which classifier the agent uses for this guardrail. Independent of `kind`:
  // governance (USER/SYSTEM) and detection (CATEGORY/COHERENCE) are separate
  // axes, so any kind can pair with any detectorType.
  @Column({
    type: 'enum',
    enum: ConversationalGuardrailDetectorType,
    enumName: 'conversational_guardrails_detector_type_enum',
    default: ConversationalGuardrailDetectorType.CATEGORY,
  })
  detectorType!: ConversationalGuardrailDetectorType;
}
