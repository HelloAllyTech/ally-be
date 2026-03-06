import { Column, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

export abstract class BaseReviewReadStatus {
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
