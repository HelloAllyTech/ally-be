import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

@Entity('review_reactions')
export class ReviewReaction extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  reviewId!: string;

  @Column()
  reaction!: string;

  @Column()
  createdBy!: number;
}
