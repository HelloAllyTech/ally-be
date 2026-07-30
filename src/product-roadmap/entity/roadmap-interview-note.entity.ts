import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Qualitative research alongside the quantitative coin votes: a user interview, optionally
 * with the raw transcript, and a summary that is either hand-written or LLM-generated from
 * the transcript.
 *
 * `summary` is required and ≤5000 chars (the LLM is instructed to stay inside that);
 * `transcript` is unbounded in the column but capped at ROADMAP_LIMITS.INTERVIEW_TRANSCRIPT_MAX
 * before being sent for summarisation.
 */
@Entity('roadmap_interview_notes')
@Index('idx_roadmap_interview_notes_created_at', ['createdAt'], {
  where: '"deletedAt" IS NULL',
})
export class RoadmapInterviewNote extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  title!: string;

  /** Who was interviewed. Free text; may be blank for anonymised notes. */
  @Column({ type: 'text', nullable: true })
  interviewee?: string | null;

  @Column({ type: 'text', nullable: true })
  transcript?: string | null;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
