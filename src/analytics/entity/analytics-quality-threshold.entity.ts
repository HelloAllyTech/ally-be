import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The 0-100 anchors for one dimension of the Roleplay Quality Index.
 *
 * ## Why this is a table and not a constant
 *
 * The index needs FIXED thresholds — a given index value has to mean the same
 * thing next quarter as it does today, which rules out normalising against a
 * rolling distribution. But fixed thresholds have to come from somewhere, and
 * inventing them is how you ship a calibrated-looking chart anchored on
 * guesses.
 *
 * So they are measured from real production traffic, once, and then frozen. A
 * measurement needs data, and a code constant cannot be written by the thing
 * that does the measuring — hence a row. The release ships placeholders, the
 * calibration task overwrites them on the first tick in an environment that
 * actually has traffic, and nothing is ever measured a second time.
 *
 * ## Frozen means frozen
 *
 * `source` is the guard, not documentation. Calibration writes ONLY rows still
 * marked `placeholder`; once a row reads `measured` it is never touched again by
 * the scheduler. Re-anchoring a live index silently rewrites the meaning of
 * every point already on the chart, so it is deliberately a human act: edit the
 * row and bump `QUALITY_INDEX_VERSION` in the same breath.
 *
 * ## No tenant_id
 *
 * The anchors describe the PLATFORM's operating range and Highlights is a
 * platform-wide super-admin view. Per-tenant anchors would mean a tenant filter
 * silently changed what 70 means, which is exactly the comparability the fixed
 * thresholds exist to protect. Same deliberate divergence from BaseEntity as
 * AnalyticsChartPreference and LlmUsage — don't "fix" it.
 */
@Index('analytics_quality_thresholds_dimension_uq', ['dimension'], {
  unique: true,
})
@Entity('analytics_quality_thresholds')
export class AnalyticsQualityThreshold {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * A `QualityIndexDimension` value, e.g. `responseLatency`. An opaque varchar
   * rather than a pg enum: retiring or renaming a dimension is a code change
   * plus a version bump, and should not also need a type migration. An
   * unrecognised row is ignored on read.
   */
  @Column({ type: 'varchar', length: 64 })
  dimension!: string;

  /**
   * Raw value that normalises to 100 (the good end).
   *
   * `double precision` because the four dimensions do not share a unit — a
   * percentage, a rate per 100 turns, and milliseconds all land in this column.
   */
  @Column({ type: 'double precision' })
  target!: number;

  /** Raw value that normalises to 0 (the bad end). */
  @Column({ type: 'double precision' })
  ceiling!: number;

  /**
   * `placeholder` (shipped guess, never shown as calibrated) or `measured`
   * (frozen, derived from production). The calibration task's write guard, and
   * what the card reads to decide whether to caveat the whole line.
   */
  @Column({ type: 'varchar', length: 16, default: 'placeholder' })
  source!: string;

  /**
   * Rows behind the measurement — sessions for the judge dimensions, turns for
   * latency. Null while placeholder. Kept because an anchor pair without its
   * `n` cannot be audited later, and this row outlives everyone's memory of the
   * day it was written.
   */
  @Column({ type: 'int', nullable: true })
  sampleSize?: number | null;

  /** When the anchors were measured. Null while placeholder. */
  @Column({ type: 'timestamp', nullable: true })
  measuredAt?: Date | null;
}
