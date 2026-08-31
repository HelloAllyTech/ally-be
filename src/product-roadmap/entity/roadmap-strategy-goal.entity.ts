import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A product strategy goal — the thing the board's composite rank is scored against.
 *
 * NOT the same concept as RoadmapProductGoal, and the names are close enough that it is worth
 * being explicit: `roadmap_opportunities.productGoal` is a CATEGORY, exactly one per
 * opportunity, used for filing and filtering ("Scribe", "Roleplay"). A strategy goal is an
 * OUTCOME the team is trying to move ("Cut time-to-first-value"), and one opportunity may
 * advance several of them or none. That many-to-many is the whole point — it is what the
 * coverage factor measures — and it is why this could not be folded into the category table.
 *
 * `name` is UNIQUE and is the FOREIGN KEY TARGET for roadmap_opportunity_goal_impacts.goalName
 * (ON UPDATE CASCADE), so renaming a goal carries every stored verdict with it and costs no
 * LLM calls.
 *
 * NO soft delete, deliberately — same reasoning as RoadmapProductGoal: a soft-deleted row would
 * still satisfy the FK, so the board would keep ranking against a goal admins believe they
 * removed. Deletion is a hard delete and cascades its impact verdicts away.
 */
@Entity('roadmap_strategy_goals')
@Index('idx_roadmap_strategy_goals_position', ['position'])
export class RoadmapStrategyGoal extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  /** Display order in the settings list. */
  @Column({ type: 'int', default: 0 })
  position!: number;
}
