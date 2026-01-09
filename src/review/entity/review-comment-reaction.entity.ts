import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('review_comment_reactions')
export class ReviewCommentReaction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  reviewCommentId!: string;

  @Column()
  reaction!: string;

  @Column()
  createdBy!: number;
}
