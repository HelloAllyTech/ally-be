import { Column, DeleteDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

export abstract class BaseReviewCommentReaction extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewCommentId!: string;

  @Column()
  reaction!: string;

  @Column()
  createdBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
