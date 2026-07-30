import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A comment on an opportunity. Flat (no threading), ≤500 chars, non-blank.
 *
 * Authorisation is deliberately ASYMMETRIC, matching the source's RLS policies:
 *   - only the AUTHOR may edit their own comment — a manager with
 *     edit:admin:product-roadmap may NOT rewrite someone else's words;
 *   - the author OR a manager may delete.
 * That asymmetry is intentional and covered by a test; don't "simplify" it into a single
 * permission check.
 */
@Entity('roadmap_opportunity_comments')
@Index('idx_roadmap_opp_comments_opp_created', ['opportunityId', 'createdAt'], {
  where: '"deletedAt" IS NULL',
})
export class RoadmapOpportunityComment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  opportunityId!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
