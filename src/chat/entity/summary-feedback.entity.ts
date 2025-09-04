import {
  BaseEntity,
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SummaryFeedbackContent = {
  issues?: string[];
  comment?: string;
};

@Entity('summary_feedback')
@Index('uq_summary_feedback_chatId_idx', ['chatId'], { unique: true })
export class SummaryFeedback extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  chatId!: number;

  @Column({ type: 'int' })
  rating!: number;

  @Column({ type: 'jsonb', nullable: true })
  feedback?: SummaryFeedbackContent;
}
