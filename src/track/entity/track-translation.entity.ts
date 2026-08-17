import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  TrackTranslationContent,
  TrackTranslationStatus,
} from '../type/track-translation.type';

/**
 * One language a course is (or is becoming) available in.
 *
 * A row exists as soon as the trainer selects the language — status
 * NOT_STARTED — so "which languages should this course be available in?" is
 * answered by the row set, independently of how much has actually been
 * translated. Learners only ever see rows with status PUBLISHED.
 *
 * The whole translated course lives in one `content` blob rather than
 * per-entity `translations` columns on `tracks`/`track_sections`/`track_items`
 * (which this supersedes) for three reasons: publishing a language is then a
 * single-row status change, a language's review state has somewhere to live,
 * and translating never writes to `track_items` — whose ids are the anchors
 * for every learner's progress rows.
 *
 * Loose-FK convention, matching the other track tables.
 */
@Entity('track_translations')
@Index(
  'uq_track_translations_track_id_language_id_idx',
  ['trackId', 'languageId'],
  { unique: true },
)
@Index('idx_track_translations_track_id', ['trackId'])
export class TrackTranslation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  /** `languages.id`. */
  @Column({ type: 'int' })
  languageId!: number;

  @Column({
    enum: TrackTranslationStatus,
    default: TrackTranslationStatus.NOT_STARTED,
  })
  status!: TrackTranslationStatus;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  content!: TrackTranslationContent;

  /**
   * Set the first time the language goes live and then left alone — an
   * unpublish keeps it, so the trainer can see this language *has* been live
   * before. `status` is the authority on whether learners see it now.
   */
  @Column({ type: 'timestamp', nullable: true })
  publishedAt?: Date | null;

  /** Correlates progress events with the run that produced this content. */
  @Column({ type: 'varchar', nullable: true })
  lastJobId?: string | null;

  /** Why the last run failed, surfaced verbatim to the trainer. */
  @Column({ type: 'text', nullable: true })
  error?: string | null;

  @Column({ type: 'int', nullable: true })
  requestedBy?: number | null;

  @Column({ type: 'int', nullable: true })
  publishedBy?: number | null;
}
