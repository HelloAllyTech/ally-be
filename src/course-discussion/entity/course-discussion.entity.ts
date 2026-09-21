import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { User } from 'src/user/entity/user.entity';
import { CourseDiscussionPost } from './course-discussion-post.entity';

@Entity('course_discussions')
export class CourseDiscussion extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  trackItemId!: string;

  @ManyToOne(() => TrackItem)
  @JoinColumn({ name: 'track_item_id' })
  trackItem!: TrackItem;

  @Column({ default: false })
  isLocked!: boolean;

  @Column()
  createdById!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User;

  @OneToMany(() => CourseDiscussionPost, (post) => post.discussion)
  posts!: CourseDiscussionPost[];
}
