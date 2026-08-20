import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Narrows one tenant-assigned course (Track 2.0) to specific cohorts.
 *
 * Same subtractive semantics as ScenarioCohortRestriction: no rows means
 * visible to the whole tenant. A NULL `cohortId` targets users in no cohort.
 *
 * Courses are the content type where the "finish what you started" rule bites
 * hardest — a learner three items into a course keeps reaching it through their
 * `track_enrollments` row even after their cohort loses browse access.
 */
@Entity('track_cohort_restrictions')
@Index(['tenantId', 'trackId'])
export class TrackCohortRestriction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'uuid', nullable: true })
  cohortId?: string | null;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @DeleteDateColumn()
  deletedAt?: Date;
}
