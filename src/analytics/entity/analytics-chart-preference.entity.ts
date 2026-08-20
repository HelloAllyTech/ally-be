import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One admin's saved controls for one analytics chart.
 *
 * The Highlights tab has no page-level date range: each chart carries its own
 * window and grain, so one reader can look at years of growth beside weeks of
 * quality. That freedom is worthless if it resets on every visit — an analyst who
 * always wants 90 days should not re-pick it daily — so the choices persist per
 * user, per chart.
 *
 * ## Why a table rather than localStorage
 *
 * Server-side because the alternative silently loses the layout when someone
 * opens the dashboard on another machine, which for a view people bring to a
 * weekly meeting is the moment it matters most.
 *
 * ## Why the row is deliberately dumb
 *
 * `chartId`, `range` and `bucket` are opaque strings here, not enums or foreign
 * keys. The client owns the chart catalogue: a chart renamed, split or retired
 * must not need a migration, and an unrecognised `chartId` on read is simply
 * ignored rather than being an error. The cost is that a stale row can outlive
 * its chart, which is why reads filter against the live catalogue and never trust
 * a stored value blindly.
 *
 * Both value columns are nullable so a user can pin a range while leaving the
 * grain at the chart's default, without the absence being expressed as a magic
 * string.
 *
 * ## Not BaseEntity
 *
 * `BaseEntity.tenant_id` is NOT NULL, and a preference belongs to a person's
 * account rather than to an org — these are platform-wide super-admin views, and
 * scoping a UI preference by tenant would mean an admin's saved layout vanished
 * when they switched the tenant filter. Same deliberate divergence as
 * `LlmUsage`; don't "fix" it by extending BaseEntity.
 */
@Index('analytics_chart_preferences_user_chart_uq', ['userId', 'chartId'], {
  unique: true,
})
@Entity('analytics_chart_preferences')
export class AnalyticsChartPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /** `users.id` of the admin the preference belongs to. */
  @Column({ type: 'int' })
  userId!: number;

  /**
   * Client-owned chart key, e.g. `highlights.practice`. Namespaced by the tab
   * that owns the chart so two tabs can hold a chart of the same name.
   */
  @Column({ type: 'varchar', length: 128 })
  chartId!: string;

  /** Saved window (an `AnalyticsRange` value), or null to use the default. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  range?: string | null;

  /** Saved grain (an `AnalyticsBucket` value), or null to use the default. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  bucket?: string | null;
}
