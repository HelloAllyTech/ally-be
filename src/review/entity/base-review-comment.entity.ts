import { Column, DeleteDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

export abstract class BaseReviewComment extends BaseEntity {
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
