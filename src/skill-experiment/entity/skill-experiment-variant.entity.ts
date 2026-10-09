import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SkillVariantStatus } from '../enum/skill-experiment.enum';
import { numericColumn } from './skill-experiment.entity';

/**
 * One version of a skill's text inside an experiment: the original (snapshot
 * of the skill at the start of a run) or a designer-drafted challenger.
 *
 * Rejected drafts are kept too, with the reason, so the admin can see what the
 * designer tried and why it never served anyone — and so the designer is told
 * not to try it again.
 *
 * The stats columns are a snapshot recomputed from `skill_experiment_
 * observations` on every engine tick; the observations are the truth.
 */
@Entity('skill_experiment_variants')
@Index(
  'UQ_skill_experiment_variants_run_ordinal',
  ['experimentId', 'run', 'ordinal'],
  {
    unique: true,
  },
)
export class SkillExperimentVariant extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  experimentId!: string;

  @Column({ type: 'int' })
  run!: number;

  /** 0 for the original, 1.. for challengers in drafting order within the run. */
  @Column({ type: 'int' })
  ordinal!: number;

  /** "Original", "V1", "V2", … */
  @Column({ type: 'varchar', length: 32 })
  label!: string;

  @Column({ type: 'boolean', default: false })
  isOriginal!: boolean;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 64 })
  contentHash!: string;

  /** The champion this draft was revised from. Null for the original. */
  @Column({ type: 'uuid', nullable: true })
  parentVariantId?: string | null;

  @Column({ type: 'varchar', length: 16 })
  status!: SkillVariantStatus;

  /** Designer's one-paragraph account of what it changed. */
  @Column({ type: 'text', nullable: true })
  changeSummary?: string | null;

  /** Designer's stated reason it expects the change to score higher. */
  @Column({ type: 'text', nullable: true })
  hypothesis?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  designerModel?: string | null;

  /** Why it was rejected or retired, in words the admin reads. */
  @Column({ type: 'text', nullable: true })
  statusReason?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  launchedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  retiredAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  judgedCount!: number;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericColumn,
  })
  meanScore?: number | null;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 3,
    nullable: true,
    transformer: numericColumn,
  })
  scoreStdDev?: number | null;

  /** Mean 1–5 score per rubric key. */
  @Column({ type: 'jsonb', nullable: true })
  criterionMeans?: Record<string, number> | null;

  /** Judged outputs that failed or broke the established output shape. */
  @Column({ type: 'int', default: 0 })
  formatFailures!: number;
}
