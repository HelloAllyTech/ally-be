import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('review_threads')
export class ReviewThread extends BaseWithoutTenantEntity {
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
}
