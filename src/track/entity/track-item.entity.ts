import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  ArticleContent,
  JournalContent,
  TrackItemCompletionCriteria,
  TrackItemType,
  VideoContent,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';

export type TrackItemContent =
  | QuizContent
  | ArticleContent
  | VideoContent
  | JournalContent;

/**
 * Hybrid polymorphism: DB-backed content types keep a typed reference column
 * (scenarioId for ROLEPLAY, caseId for CASE); inline-authored content
 * (QUIZ/ARTICLE/VIDEO/JOURNAL) lives in the `content` JSONB.
 * Item ids are stable across content edits — learner progress rows point here.
 */
@Entity('track_items')
export class TrackItem extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'uuid' })
  trackSectionId!: string;

  @Column({ enum: TrackItemType })
  type!: TrackItemType;

  @Column()
  order!: number;

  @Column()
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'int', nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  caseId?: string;

  @Column({ type: 'jsonb', nullable: true })
  content?: TrackItemContent;

  @Column({ type: 'jsonb', nullable: true })
  completionCriteria?: TrackItemCompletionCriteria;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
