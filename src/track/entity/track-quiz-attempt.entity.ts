import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  QuizAnswer,
  QuizAttemptStatus,
  QuizQuestionGrading,
} from '../type/quiz.type';

@Entity('track_quiz_attempts')
export class TrackQuizAttempt extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackItemProgressId!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  @Column()
  userId!: number;

  @Column({ type: 'int' })
  attemptNumber!: number;

  @Column({ type: 'jsonb' })
  answers!: QuizAnswer[];

  @Column({ type: 'jsonb', nullable: true })
  grading?: QuizQuestionGrading[];

  @Column({ type: 'numeric', nullable: true })
  scorePct?: number;

  @Column({ type: 'boolean', nullable: true })
  passed?: boolean;

  @Column({ enum: QuizAttemptStatus, default: QuizAttemptStatus.SUBMITTED })
  status!: QuizAttemptStatus;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  gradedAt?: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
