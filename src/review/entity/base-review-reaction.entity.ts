import { Column, DeleteDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

export abstract class BaseReviewReaction extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewId!: string;

  @Column()
  reaction!: string;

  @Column()
  createdBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
