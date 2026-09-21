import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { User } from 'src/user/entity/user.entity';
import { CourseDiscussion } from './course-discussion.entity';

@Entity('course_discussion_posts')
export class CourseDiscussionPost extends BaseEntity {
  @Column({ type: 'uuid' })
  discussionId!: string;

  @ManyToOne(
    () => CourseDiscussion,
    (discussion) => discussion.posts,
  )
  @JoinColumn({ name: 'discussion_id' })
  discussion!: CourseDiscussion;

  @Column({ type: 'uuid' })
  authorId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author!: User;

  @Column({ type: 'uuid', nullable: true })
  parentPostId?: string;

  @ManyToOne(
    () => CourseDiscussionPost,
    (post) => post.replies,
    { nullable: true },
  )
  @JoinColumn({ name: 'parent_post_id' })
  parentPost?: CourseDiscussionPost;

  @OneToMany(
    () => CourseDiscussionPost,
    (post) => post.parentPost,
  )
  replies!: CourseDiscussionPost[];

  @Column({ type: 'text' })
  content!: string;

  @Column({ default: false })
  isEdited!: boolean;

  @Column({ default: false })
  isDeletedByAuthor!: boolean;
}
