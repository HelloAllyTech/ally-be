import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LabQuestionSet } from './lab-question-set.entity';
import { LabEvalQuestionType } from './lab-eval-question.entity';

/**
 * One question belonging to a LabQuestionSet. Same shape as
 * lab_eval_questions; replaced wholesale while the parent set is a draft
 * (see LabQuestionSetService.update), frozen once the set is published.
 */
@Entity('lab_question_set_questions')
@Index('idx_lab_question_set_questions_set_id', ['questionSetId'])
export class LabQuestionSetQuestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'question_set_id', type: 'uuid' })
  questionSetId!: string;

  @ManyToOne(() => LabQuestionSet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_set_id' })
  questionSet?: LabQuestionSet;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'varchar', length: 20 })
  type!: LabEvalQuestionType;

  @Column({ name: 'scale_min', type: 'int', default: 1 })
  scaleMin!: number;

  @Column({ name: 'scale_max', type: 'int', default: 5 })
  scaleMax!: number;

  /** Display order within the set. */
  @Column({ type: 'int', default: 0 })
  position!: number;
}
