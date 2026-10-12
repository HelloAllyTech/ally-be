import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  SkillExperimentPauseReason,
  SkillExperimentStatus,
} from '../enum/skill-experiment.enum';
import {
  RubricCriterion,
  SkillOutputShape,
} from '../type/skill-experiment.type';

/** Postgres returns `numeric` as a string; read it back as a number. */
export const numericColumn = {
  to: (value?: number | null) => value ?? null,
  from: (value?: string | null) =>
    value === null || value === undefined ? null : parseFloat(value),
};

/**
 * The auto-improve loop for one System Skill (`prompts` row). One row per
 * skill, kept across runs: stopping and restarting bumps `run` rather than
 * creating a new row, so the history of every attempt stays on one record.
 *
 * System-wide like `prompts` itself (no tenant): a skill's text is shared by
 * every tenant, so its experiment is too. That is why reading one is gated on
 * EDIT_PROMPT-level permissions — the observations it holds span tenants.
 *
 * The state machine lives in SkillExperimentEngineService; the docblock on
 * SkillExperimentStatus describes each state.
 */
@Entity('skill_experiments')
export class SkillExperiment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('UQ_skill_experiments_prompt', { unique: true })
  @Column({ type: 'uuid' })
  promptId!: string;

  /** Snapshotted for the hot-path router, which never joins `prompts`. */
  @Column({ type: 'varchar', length: 255 })
  promptCode!: string;

  @Column({ type: 'varchar', length: 16, default: SkillExperimentStatus.OFF })
  status!: SkillExperimentStatus;

  @Column({ type: 'varchar', length: 32, nullable: true })
  pausedReason?: SkillExperimentPauseReason | null;

  /** Increments on every start and every reset; variants carry the run they belong to. */
  @Column({ type: 'int', default: 0 })
  run!: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  rubric!: RubricCriterion[];

  /** 0–100. Pausing once the champion's mean reaches this is the loop's goal. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 85,
    transformer: numericColumn,
  })
  targetScore!: number;

  /** Judged outputs a variant needs before it can be compared. */
  @Column({ type: 'int', default: 30 })
  minSamplesPerVariant!: number;

  /** Share of traffic the challenger gets while testing, 5–50. */
  @Column({ type: 'int', default: 30 })
  challengerTrafficPercent!: number;

  /** Challengers this run may draft before pausing. */
  @Column({ type: 'int', default: 8 })
  maxVariants!: number;

  /** Losing challengers in a row before pausing for lack of progress. */
  @Column({ type: 'int', default: 3 })
  maxConsecutiveLosses!: number;

  /** Points (0–100 scale) a challenger must lead by to replace the champion. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 2,
    transformer: numericColumn,
  })
  minImprovement!: number;

  /**
   * Judge model id. Null → the judge task's tier default. Locked while a run is
   * live: scores from two judges are not comparable.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  judgeModel?: string | null;

  /** Designer model id. Null → the designer prompt row's model, else its tier. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  designerModel?: string | null;

  /**
   * sha256 of the skill text this run started from. When the live skill text
   * stops matching (an admin edited it), the engine resets the run — the
   * comparison no longer describes what the original arm would serve.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  baseContentHash?: string | null;

  /** Established from the original's outputs at the end of the baseline. */
  @Column({ type: 'jsonb', nullable: true })
  outputShape?: SkillOutputShape | null;

  @Column({ type: 'uuid', nullable: true })
  championVariantId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  challengerVariantId?: string | null;

  /** Per-run budget counters; reset on start and resume. */
  @Column({ type: 'int', default: 0 })
  variantsDrafted!: number;

  @Column({ type: 'int', default: 0 })
  consecutiveLosses!: number;

  @Column({ type: 'int', default: 0 })
  designFailures!: number;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  pausedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastTickAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
