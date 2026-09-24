import { BaseEntity } from 'src/common/entity/base.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A top-level post (depth 1, no parent) or a reply (depth 2–3). Plain text only.
 *
 * `rootPostId` is the top-level post a reply sits under — null on the top-level
 * post itself. The thread lock lives on the root, and a moderator's subtree
 * delete is scoped by it.
 *
 * An author deleting a post that still has replies sets `isDeletedByAuthor`
 * and blanks `content`, leaving a placeholder that keeps the replies in context;
 * every other delete is a soft delete (`deletedAt`).
 */
@Entity('course_discussion_posts')
export class CourseDiscussionPost extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  discussionId!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  @Column({ type: 'integer' })
  authorId!: number;

  @Column({ type: 'uuid', nullable: true })
  parentPostId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  rootPostId?: string | null;

  @Column({ type: 'smallint', default: 1 })
  depth!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'boolean', default: false })
  isEdited!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  editedAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  editedById?: number | null;

  @Column({ type: 'boolean', default: false })
  isDeletedByAuthor!: boolean;

  /** Thread lock — meaningful on a top-level post only. */
  @Column({ type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ type: 'integer', nullable: true })
  deletedById?: number | null;

  @DeleteDateColumn()
  deletedAt?: Date | null;
}
