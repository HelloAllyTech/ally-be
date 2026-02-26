import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('review_read_status')
@Unique(['userId', 'reviewId'])
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
