import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';
import { CustomFieldDefinition } from './custom-field-definition.entity';

@Entity('chat_custom_field_values')
@Index('idx_chat_custom_field_values_tenant_chat', ['tenantId', 'chatId'])
@Index('idx_chat_custom_field_values_tenant_field', [
  'tenantId',
  'fieldDefinitionId',
])
@Unique('uq_chat_custom_field_values_chat_field', [
  'chatId',
  'fieldDefinitionId',
])
export class ChatCustomFieldValue extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  chatId!: number;

  @Column()
  fieldDefinitionId!: string;

  @ManyToOne(() => CustomFieldDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'fieldDefinitionId',
    foreignKeyConstraintName: 'fk_chat_custom_field_values_definition',
  })
  fieldDefinition?: CustomFieldDefinition;

  @Column({ nullable: true })
  value?: string;

  @Column()
  updatedBy!: number;
}
