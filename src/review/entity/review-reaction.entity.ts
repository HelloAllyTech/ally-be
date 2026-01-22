import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';

@Entity('review_reactions')
export class ReviewReaction extends BaseEntity {
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
