import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { LabRun } from './lab-run.entity';
import { LabEvaluator } from './lab-evaluator.entity';

/**
 * Assignment of one published AI Lab run to one evaluator. `submittedAt`
 * flips exactly once, when the evaluator submits their answers — after that
 * the evaluation is immutable (no update path exists) and the assignment can
 * no longer be removed.
 */
@Entity('lab_run_assignments')
@Unique('uq_lab_run_assignments_run_evaluator', ['runId', 'evaluatorId'])
@Index('idx_lab_run_assignments_evaluator_id', ['evaluatorId'])
@Index('idx_lab_run_assignments_run_id', ['runId'])
export class LabRunAssignment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @ManyToOne(() => LabRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: LabRun;

  @Column({ name: 'evaluator_id', type: 'uuid' })
  evaluatorId!: string;

  @ManyToOne(() => LabEvaluator, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evaluator_id' })
  evaluator?: LabEvaluator;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
