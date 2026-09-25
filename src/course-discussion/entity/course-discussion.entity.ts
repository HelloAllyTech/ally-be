import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The discussion attached to one course item for one organisation. Courses are
 * shared across organisations; their discussions are not. Created lazily on the
 * first post (or a moderator's lock), so an item nobody has posted on has no row.
 */
@Entity('course_discussions')
@Index('idx_course_discussions_item_tenant', ['trackItemId', 'tenantId'], {
  unique: true,
})
export class CourseDiscussion extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackId!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  /** Whole-discussion lock: no new posts or replies anywhere under the item. */
  @Column({ type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ type: 'integer', nullable: true })
  lockedById?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  createdById?: number | null;
}
