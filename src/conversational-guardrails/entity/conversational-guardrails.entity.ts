import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

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
}
