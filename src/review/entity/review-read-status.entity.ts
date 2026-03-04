import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('review_read_status')
@Index('IDX_review_read_status_user_review', ['userId', 'reviewId'], { unique: true })
export class ReviewReadStatus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  userId!: number;

  @Column({ type: 'uuid' })
  reviewId!: string;

  @Column({ type: 'timestamp' })
  readAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
