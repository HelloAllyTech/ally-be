import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * The metric-based product goal taxonomy every opportunity is filed under.
 *
 * `name` is UNIQUE and is the FOREIGN KEY TARGET for roadmap_opportunities.productGoal
 * (ON UPDATE CASCADE), so renaming a goal propagates to every opportunity and to the goal
 * names stored inside saved-view state.
 *
 * NO soft delete, deliberately: a soft-deleted row would still satisfy the FK, so the board
 * would keep showing a goal admins believe they removed. Deletion is a hard delete and is
 * blocked by ON DELETE RESTRICT while any opportunity still points at it.
 */
@Entity('roadmap_product_goals')
@Index('idx_roadmap_product_goals_position', ['position'])
export class RoadmapProductGoal extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  /** Display order in the picker and the settings list. */
  @Column({ type: 'int', default: 0 })
  position!: number;
}
