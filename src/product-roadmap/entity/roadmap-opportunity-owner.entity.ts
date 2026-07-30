import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The admin-managed list of opportunity owners. These are free-text NAMES, not Ally users —
 * an owner is "who is driving this", which in the source app never needed to be an account.
 *
 * `name` is UNIQUE and is the FOREIGN KEY TARGET for roadmap_opportunities.owner
 * (ON UPDATE CASCADE ON DELETE SET NULL): renaming propagates, and removing an owner
 * un-assigns their opportunities rather than blocking.
 *
 * NO soft delete, for the same reason as roadmap_product_goals — it is an FK target.
 */
@Entity('roadmap_opportunity_owners')
@Index('idx_roadmap_opp_owners_position', ['position'])
export class RoadmapOpportunityOwner extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'int', default: 0 })
  position!: number;
}
