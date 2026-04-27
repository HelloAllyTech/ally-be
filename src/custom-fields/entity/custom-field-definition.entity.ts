import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

export enum CustomFieldType {
  SINGLE_SELECT = 'SINGLE_SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  DATE = 'DATE',
  TEXT = 'TEXT',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
}

export enum CustomFieldEditPermission {
  ADMIN_ONLY = 'ADMIN_ONLY',
  COUNSELLOR_ONLY = 'COUNSELLOR_ONLY',
  BOTH = 'BOTH',
}

export enum CustomFieldFillMode {
  MANUAL = 'MANUAL',
  AI = 'AI',
}

export interface SingleSelectOption {
  id: string;
  label: string;
  order: number;
}

@Entity('custom_field_definitions')
@Index(['tenantId', 'isActive'])
export class CustomFieldDefinition extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'enum', enum: CustomFieldType })
  fieldType!: CustomFieldType;

  @Column({ type: 'jsonb', nullable: true })
  options?: SingleSelectOption[];

  @Column()
  sectionKey!: string;

  @Column({
    type: 'enum',
    enum: CustomFieldEditPermission,
    default: CustomFieldEditPermission.BOTH,
  })
  editPermission!: CustomFieldEditPermission;

  @Column({
    type: 'enum',
    enum: CustomFieldFillMode,
    default: CustomFieldFillMode.MANUAL,
  })
  fillMode!: CustomFieldFillMode;

  @Column({ default: 0 })
  displayOrder!: number;

  @Column({ default: true })
  showInTable!: boolean;

  @Column({ default: true })
  isActive!: boolean;

  @Column()
  createdBy!: number;

  @Column()
  updatedBy!: number;
}
