import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('conversational_guardrails')
export class ConversationalGuardrails extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  helperDialogue!: string;

  @Column({ type: 'text' })
  actorDialogue!: string;

  @Column({ default: true })
  active!: boolean;
}
