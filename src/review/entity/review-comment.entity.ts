import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

@Entity('review_comments')
export class ReviewComment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewThreadId!: string;

  @Column()
  content!: string;

  @Column()
  createdBy!: number;

  @Column({ type: 'uuid', nullable: true })
  parentCommentId?: string;

  @Column({ default: false, nullable: true })
  hidden?: boolean;

  @DeleteDateColumn()
  deletedAt!: Date;
}
