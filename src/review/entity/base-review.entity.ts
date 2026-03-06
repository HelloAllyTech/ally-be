import { Column, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { ReviewStatus } from '../type/review.type';

export abstract class BaseReview extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  createdBy!: number;

  @Column({ enum: ReviewStatus, default: ReviewStatus.IN_REVIEW })
  status!: ReviewStatus;

  @Column({ type: 'varchar', nullable: true })
  note?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  noteEditedAt?: Date | null;
}
