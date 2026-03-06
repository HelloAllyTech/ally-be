import { Column, DeleteDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

export abstract class BaseReviewThread extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewId!: string;

  @Column({ nullable: true })
  messageId?: number;

  @Column()
  createdBy!: number;

  @Column({ type: 'jsonb', nullable: true })
  selection?: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
