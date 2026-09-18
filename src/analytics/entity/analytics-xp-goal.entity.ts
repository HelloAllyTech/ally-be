import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A literal XP target for one calendar period, at one grain.
 *
 * Platform-wide by design — Goals is a leadership view of the whole
 * platform's output, not a per-tenant one. Same deliberate divergence from a
 * tenant-scoped BaseEntity as AnalyticsQualityThreshold: a goal describes the
 * platform's target, and a tenant filter silently changing what "the goal"
 * means is exactly the ambiguity a fixed target exists to avoid.
 *
 * Rows are written by migration, not through this application's API — see
 * `CreateAnalyticsXpGoals` for why. A missing row for a period is a fact ("no
 * goal was set"), not an error: GoalsXpAnalyticsRepository returns `null` for
 * it rather than 0.
 */
@Index('analytics_xp_goals_grain_period_uq', ['grain', 'periodStart'], {
  unique: true,
})
@Entity('analytics_xp_goals')
export class AnalyticsXpGoal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** 'month' | 'quarter' | 'year'. Opaque varchar, like other analytics dimension columns. */
  @Column({ type: 'varchar', length: 10 })
  grain!: string;

  /** First day of the period (UTC), e.g. 2026-01-01 for Jan 2026 or Q1 2026. */
  @Column({ type: 'date' })
  periodStart!: string;

  /** The XP target for this period. */
  @Column({ type: 'integer' })
  targetXp!: number;
}
