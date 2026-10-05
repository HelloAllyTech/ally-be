import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TrackProgressionMode, TrackStatus } from '../type/track.type';

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

  @DeleteDateColumn()
  deletedAt?: Date;
}
