import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * An AI Lab variable: a uniquely-named placeholder that can be referenced from
 * a skill's system-prompt template as `{{name}}` and replaced with one of its
 * values (see LabValue) at run time. The name is unique across the library.
 */
@Entity('lab_variables')
export class LabVariable extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_lab_variables_name', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
