import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { SkillObservationStatus } from '../enum/skill-experiment.enum';
import { CriterionVerdicts } from '../type/skill-experiment.type';
import { numericColumn } from './skill-experiment.entity';

/**
 * One execution of a skill under an experiment: what it ran on, what it
 * produced (or how it failed), and the judge's verdict.
 *
 * Holds raw skill input and output — e.g. a roleplay transcript and its
 * debrief — and is kept indefinitely (a product decision; see
 * docs/skill-experiments.md). `tenantId` is stamped so the data can be scoped
 * or purged per tenant later. Readable only with EDIT_PROMPT-level permission.
 */
@Entity('skill_experiment_observations')
@Index('IDX_skill_experiment_observations_experiment_status', [
  'experimentId',
  'status',
])
@Index('IDX_skill_experiment_observations_variant_status', [
  'variantId',
  'status',
])
export class SkillExperimentObservation extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  experimentId!: string;

  @Column({ type: 'uuid' })
  variantId!: string;

  @Column({ type: 'varchar', length: 255 })
  promptCode!: string;

  @Column({ type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'jsonb' })
  input!: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  output?: string | null;

  /** The skill call itself failed. Scored 0 without calling the judge. */
  @Column({ type: 'text', nullable: true })
  skillError?: string | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: SkillObservationStatus.PENDING,
  })
  status!: SkillObservationStatus;

  /** False when the output failed or broke the established shape. */
  @Column({ type: 'boolean', nullable: true })
  formatOk?: boolean | null;

  /** 0–100, weighted across the rubric. */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericColumn,
  })
  score?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  criterionScores?: CriterionVerdicts | null;

  @Column({ type: 'text', nullable: true })
  judgeSummary?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  judgeModel?: string | null;

  @Column({ type: 'text', nullable: true })
  judgeError?: string | null;

  @Column({ type: 'int', default: 0 })
  judgeAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  judgedAt?: Date | null;
}
