import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';
import { CustomFieldDefinition } from './custom-field-definition.entity';

@Entity('chat_custom_field_values')
@Index(['tenantId', 'chatId'])
@Index(['tenantId', 'fieldDefinitionId'])
export class ChatCustomFieldValue extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  chatId!: number;

  @Column()
  fieldDefinitionId!: string;

  @ManyToOne(() => CustomFieldDefinition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fieldDefinitionId' })
  fieldDefinition?: CustomFieldDefinition;

  @Column({ nullable: true })
  value?: string;

  @Column()
  updatedBy!: number;
}
