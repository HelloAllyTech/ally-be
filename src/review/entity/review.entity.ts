import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { ReviewStatus } from '../type/review.type';

@Entity('reviews')
export class Review extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  createdBy!: number;

  @Column({ enum: ReviewStatus, default: ReviewStatus.IN_REVIEW })
  status!: ReviewStatus;

  @Column({ type: 'varchar', nullable: true })
  note?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  noteEditedAt?: Date | null;
}
