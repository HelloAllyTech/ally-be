import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackProgressionMode, TrackStatus } from '../type/track.type';
import { TrackLandingPage } from '../type/track-landing-page.type';

@Entity('tracks')
export class Track extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ nullable: true })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ nullable: true })
  coverImageUrl?: string;

  @Column({ enum: TrackStatus, default: TrackStatus.DRAFT })
  status!: TrackStatus;

  @Column({ default: false })
  isGlobal!: boolean;

  // Public view: when on, the course's share link (`/course/:id` on the learner
  // app) shows its outline to anyone, logged in or not. Off by default for
  // every course, old and new. It reveals the outline only — taking the course
  // still needs an account whose organisation and group the course is assigned
  // to (`assertTrackAvailable`). Served only while the course is ACTIVE.
  @Column({ default: false })
  isPublicView!: boolean;

  @Column({
    enum: TrackProgressionMode,
    default: TrackProgressionMode.SEQUENTIAL,
  })
  progressionMode!: TrackProgressionMode;

  @Column({ type: 'int', default: 0 })
  totalItems!: number;

  @Column({ type: 'int', nullable: true })
  estimatedDurationMinutes?: number;

  @Column({ nullable: true })
  createdBy?: number;

  @Column({ nullable: true })
  updatedBy?: number;

  @Column({ type: 'jsonb', nullable: true })
  translations?: Record<string, any>;

  // The competencies the author says this course teaches: a jsonb array of
  // `competencies.id` uuid strings, stored the same way as
  // `scenarios.competencyIds`. NULL = not tagged — Analytics → Course impact
  // then falls back to the competencies of the course's roleplay scenarios. An
  // empty selection is stored as NULL, never `[]` (a CHECK enforces it), so
  // "tagged" always means at least one id. See normaliseTrackCompetencyIds.
  @Column({ type: 'jsonb', nullable: true })
  competencyIds?: string[] | null;

  // The course's story-led landing page: hook, persona, first move, story arc,
  // outcomes, cast and the per-block switches, always stored as the full
  // normalised shape (`normaliseTrackLandingPage`). NULL = never set up, which
  // is every course until its author opts in. A non-empty `hero.hook` is what
  // turns story mode on for the public share link; without one the outline
  // renders exactly as before. Section ids inside it are not foreign keys — one
  // that no longer exists is ignored at read time — and `duplicateTrack`
  // re-points them at the copy's sections.
  @Column({ type: 'jsonb', nullable: true })
  landingPage?: TrackLandingPage | null;

  @DeleteDateColumn()
  deletedAt?: Date;
}
