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

/**
 * Who owns this custom field definition.
 * - SUPER_ADMIN: created from the scribe-settings flow (super admin tenant
 *   override); only super admins can manage it.
 * - ORG_ADMIN: created from the in-app "manage custom fields" flow within a
 *   tenant; the org admin / counsellor manages it.
 */
export enum CustomFieldScope {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ORG_ADMIN = 'ORG_ADMIN',
}

export interface SingleSelectOption {
  id: string;
  label: string;
  order: number;
}

@Entity('custom_field_definitions')
@Index('idx_custom_field_definitions_tenant_active', ['tenantId', 'isActive'])
export class CustomFieldDefinition extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({
    type: 'enum',
    enum: CustomFieldType,
    enumName: 'custom_field_type_enum',
  })
  fieldType!: CustomFieldType;

  @Column({ type: 'jsonb', nullable: true })
  options?: SingleSelectOption[];

  @Column()
  sectionKey!: string;

  @Column({
    type: 'enum',
    enum: CustomFieldEditPermission,
    enumName: 'custom_field_edit_permission_enum',
    default: CustomFieldEditPermission.BOTH,
  })
  editPermission!: CustomFieldEditPermission;

  @Column({
    type: 'enum',
    enum: CustomFieldFillMode,
    enumName: 'custom_field_fill_mode_enum',
    default: CustomFieldFillMode.MANUAL,
  })
  fillMode!: CustomFieldFillMode;

  @Column({ type: 'text', nullable: true })
  aiInstruction?: string;

  @Column({
    type: 'enum',
    enum: CustomFieldScope,
    default: CustomFieldScope.ORG_ADMIN,
  })
  scope!: CustomFieldScope;

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
