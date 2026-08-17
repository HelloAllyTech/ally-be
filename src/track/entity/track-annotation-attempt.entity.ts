import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnnotationGrading, AnnotationMark } from '../type/annotation.type';

/**
 * One row per submitted annotation attempt. Shaped after track_quiz_attempts,
 * minus the status column: annotation grading is pure and synchronous, so an
 * attempt is never PENDING_GRADING and there is nothing to regrade.
 */
@Entity('track_annotation_attempts')
export class TrackAnnotationAttempt extends BaseWithoutTenantEntity {
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

  /** The (unitId, labelId) pairs the learner marked. */
  @Column({ type: 'jsonb' })
  marks!: AnnotationMark[];

  /** Full grading including misses — reveal gating happens on read, not here. */
  @Column({ type: 'jsonb', nullable: true })
  grading?: AnnotationGrading;

  @Column({ type: 'numeric', nullable: true })
  scorePct?: number;

  @Column({ type: 'boolean', nullable: true })
  passed?: boolean;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt?: Date;

  @DeleteDateColumn()
  deletedAt?: Date;
}
