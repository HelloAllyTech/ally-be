import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LabVariable } from './lab-variable.entity';

/**
 * A concrete value bound to a LabVariable. A variable can have many candidate
 * values (e.g. the variable `tone` might have values "empathetic", "firm",
 * "playful"); a run picks one to substitute into a skill's template. Deleting
 * the parent variable cascades to its values.
 */
@Entity('lab_values')
@Index('idx_lab_values_variable_id', ['variableId'])
export class LabValue extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'variable_id', type: 'uuid' })
  variableId!: string;

  @ManyToOne(() => LabVariable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'variable_id' })
  variable?: LabVariable;

  /** Optional human-friendly label for this value (e.g. "Angry customer"). */
  @Column({ type: 'text', nullable: true })
  label?: string | null;

  @Column({ type: 'text' })
  value!: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
