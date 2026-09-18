import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One LLM verdict: does this opportunity positively move this strategy goal?
 *
 * These rows ARE the goal-impact factor. Coverage is computed live as
 * `COUNT(*) FILTER (WHERE helped) / (SELECT COUNT(*) FROM roadmap_strategy_goals)` — never
 * stored — so the denominator always matches the goal list that exists right now.
 *
 * WHY VERDICT ROWS RATHER THAN A STORED PERCENTAGE. A percentage is only meaningful against the
 * goal list it was computed from, and that list changes. Keeping the individual verdicts makes
 * two of the three mutations free:
 *
 *   - goal DELETED → rows cascade away, coverage recomputes correctly, no LLM calls
 *   - goal RENAMED → ON UPDATE CASCADE carries the rows, no LLM calls
 *   - goal ADDED   → genuinely unknown for existing rows; the only case needing the model
 *
 * That last case is what makes staleness DETECTABLE rather than silent: an opportunity with
 * fewer impact rows than there are goals has not been assessed against all of them, so the
 * settings UI can say "N not yet assessed against this goal" and offer a bulk re-run. Without
 * per-goal rows the board would simply divide by the wrong number and look confident.
 *
 * NOT USER-EDITABLE. The assessment is machine-derived and read-only by design — a score
 * anyone could hand-edit is a score people would edit to move their own idea up the rank. The
 * correction path is re-running the assessment (the drawer's Reassess action), not overriding
 * the verdict. This is the one place this module deliberately differs from `effort`, which is
 * explicitly a proposal the filer may correct.
 *
 * `reason` is the model's one-line justification, ≤500 chars, shown in the drawer breakdown so
 * a verdict can be argued with rather than just believed.
 */
@Entity('roadmap_opportunity_goal_impacts')
@Unique('UQ_roadmap_opp_goal_impacts_opp_goal', ['opportunityId', 'goalName'])
@Index('idx_roadmap_opp_goal_impacts_opportunity', ['opportunityId'])
export class RoadmapOpportunityGoalImpact extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to roadmap_opportunities(id), ON DELETE CASCADE. */
  @Column({ type: 'uuid' })
  opportunityId!: string;

  /** FK BY NAME to roadmap_strategy_goals(name), ON UPDATE CASCADE ON DELETE CASCADE. */
  @Column({ type: 'text' })
  goalName!: string;

  @Column({ type: 'boolean' })
  helped!: boolean;

  /** The model's justification for the verdict, ≤500 chars. */
  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  /**
   * When this verdict was produced. Distinct from `updatedAt` because it is the answer to
   * "how old is this judgement", which is what the drawer shows — an upsert that rewrites an
   * identical verdict still moves updatedAt.
   */
  @Column({ type: 'timestamp', default: () => 'now()' })
  assessedAt!: Date;
}
