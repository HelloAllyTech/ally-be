import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LabRun } from './lab-run.entity';

export enum LabEvalQuestionType {
  RATING = 'RATING',
  YES_NO = 'YES_NO',
  TEXT = 'TEXT',
  /** Explanatory text shown to the evaluator; not answered or submitted. */
  DESCRIPTION = 'DESCRIPTION',
}

/**
 * A human-evaluation question attached to a published AI Lab run. Questions
 * are fixed at publish time (a run is published exactly once, with at least
 * one question) and are answered by assigned evaluators through the
 * /evaluate micro-app. Deleting the run cascades to its questions.
 */
@Entity('lab_eval_questions')
@Index('idx_lab_eval_questions_run_id', ['runId'])
export class LabEvalQuestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @ManyToOne(() => LabRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'run_id' })
  run?: LabRun;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: LabEvalQuestionType;

  /** Inclusive rating bounds; only meaningful for RATING questions. */
  @Column({ name: 'scale_min', type: 'int', default: 1 })
  scaleMin!: number;

  @Column({ name: 'scale_max', type: 'int', default: 5 })
  scaleMax!: number;

  /** Display order within the run's question list. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /**
   * If this question was imported from a Question Set at publish time, the
   * set's id (for traceability only — no app logic reads this). Null for
   * ad-hoc questions. Soft reference (ON DELETE SET NULL): sets are
   * archive-only once published, so this rarely goes null in practice.
   */
  @Column({ name: 'source_question_set_id', type: 'uuid', nullable: true })
  sourceQuestionSetId?: string | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
