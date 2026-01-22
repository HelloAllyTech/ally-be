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

  @Column()
  messageId!: number;

  @Column()
  createdBy!: number;

  @Column({ type: 'jsonb' })
  selection!: Record<string, any>;

  @DeleteDateColumn()
  deletedAt?: Date;
}
