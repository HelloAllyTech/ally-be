import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

@Entity('review_comment_reactions')
export class ReviewCommentReaction extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewCommentId!: string;

  @Column()
  reaction!: string;

  @Column()
  createdBy!: number;
}
