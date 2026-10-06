import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * The helping-skills judgement of one ended chat (contract §10, QA). Written by
 * the QA job; levels are "score 1–4" and never ranked between listeners.
 */
@Entity('helpline_qa_scores')
@Index('idx_helpline_qa_scores_listener', ['tenantId', 'listenerId'])
export class HelplineQaScore extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chat_id', unique: true })
  chatId!: string;

  @Column({ type: 'int', name: 'listener_id' })
  listenerId!: number;

  @Column({ type: 'varchar', length: 64, name: 'rubric_version' })
  rubricVersion!: string;

  /** `{ skillKey: 1..4 }`. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  levels!: Record<string, number>;

  /** Judge output, incl. ticked behaviours and evidence message ids. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  verdicts!: Record<string, unknown>;

  @Column({ type: 'real', name: 'composite_score' })
  compositeScore!: number;

  @Column({ type: 'boolean', name: 'has_unhelpful_behaviour', default: false })
  hasUnhelpfulBehaviour!: boolean;

  @Column({ type: 'varchar', length: 120, name: 'judge_model' })
  judgeModel!: string;
}
