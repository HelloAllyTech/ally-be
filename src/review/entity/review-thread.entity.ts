import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

@Entity('review_threads')
export class ReviewThread extends BaseEntity {
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
