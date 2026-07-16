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
import { LabRunAssignment } from './lab-run-assignment.entity';
import { LabEvalQuestion } from './lab-eval-question.entity';

/**
 * One evaluator's answer to one question of an assigned run. Answers are
 * written exactly once, atomically with the assignment's `submittedAt`, and
 * are immutable thereafter. Exactly one of the typed value columns is set,
 * matching the question's type (RATING → answerRating, YES_NO → answerBool,
 * TEXT → answerText).
 */
@Entity('lab_eval_answers')
@Unique('uq_lab_eval_answers_assignment_question', [
  'assignmentId',
  'questionId',
])
@Index('idx_lab_eval_answers_question_id', ['questionId'])
export class LabEvalAnswer extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId!: string;

  @ManyToOne(() => LabRunAssignment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assignment_id' })
  assignment?: LabRunAssignment;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId!: string;

  @ManyToOne(() => LabEvalQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question?: LabEvalQuestion;

  @Column({ name: 'answer_text', type: 'text', nullable: true })
  answerText?: string | null;

  @Column({ name: 'answer_rating', type: 'int', nullable: true })
  answerRating?: number | null;

  @Column({ name: 'answer_bool', type: 'boolean', nullable: true })
  answerBool?: boolean | null;
}
