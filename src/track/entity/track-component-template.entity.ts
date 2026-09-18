import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { TrackItemCompletionCriteria, TrackItemType } from '../type/track.type';
import { TrackItemContent } from './track-item.entity';

/**
 * A saved, fully-configured Track/Course item a course author can insert as
 * the starting point for a new item elsewhere. Global and cross-tenant — no
 * `tenantId`, every row is visible to every caller who holds the permission —
 * and hard-deleted (no `deletedAt`): a deleted template leaves no trace in
 * courses that already inserted a copy of its content, because inserting is a
 * one-time deep copy with no live link back to the template.
 *
 * Restricted to the five inline-authored item types (JOURNAL, QUIZ, ARTICLE,
 * VIDEO, ANNOTATED_ARTIFACT); ROLEPLAY/CASE/GAME are not supported — see
 * `TrackComponentTemplateService.create`.
 */
@Entity('track_component_templates')
export class TrackComponentTemplate extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  type!: TrackItemType;

  @Column()
  title!: string;

  @Column({ type: 'jsonb' })
  content!: TrackItemContent;

  @Column({ type: 'jsonb', nullable: true })
  completionCriteria?: TrackItemCompletionCriteria;

  @Column({ name: 'created_by' })
  createdBy!: number;

  @Column({ name: 'updated_by' })
  updatedBy!: number;
}
