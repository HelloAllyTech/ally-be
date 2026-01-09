import {
  Column,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('review_comments')
export class ReviewComment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewThreadId!: string;

  @Column()
  content!: string;

  @Column()
  createdBy!: number;

  @Column({ type: 'uuid', nullable: true })
  parentCommentId?: string;

  @Column({ default: false, nullable: true })
  hidden?: boolean;

  @DeleteDateColumn()
  deletedAt!: Date;
}
