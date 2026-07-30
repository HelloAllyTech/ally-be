import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * A reusable, named list of human-evaluation questions. Draft while
 * `publishedAt` is null (freely editable, including its question list);
 * publishing locks the question list permanently (mirrors LabRun.publishedAt).
 * `archivedAt` is a separate, reversible toggle — only meaningful once
 * published — that hides the set from the run-publish picker without
 * deleting it, so runs that already imported its questions are unaffected.
 */
@Entity('lab_question_sets')
export class LabQuestionSet extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_lab_question_sets_name')
  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'archived_at', type: 'timestamp', nullable: true })
  archivedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;
}
