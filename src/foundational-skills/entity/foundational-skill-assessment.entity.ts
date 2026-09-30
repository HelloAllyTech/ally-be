import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';

/** One skill's verdict as stored: what was seen, and the level derived from it. */
export interface StoredSkillVerdict {
  skill: string;
  opportunity: boolean;
  level: 1 | 2 | 3 | 4 | null;
  observed: string[];
  notApplicable: string[];
}

/**
 * The foundational-skills judgement of one cut under one rubric version.
 *
 * Keyed `(cutId, rubricVersion)`: bumping `FHS_RUBRIC_VERSION` leaves every old
 * row in place and makes the scheduler score each cut again under the new one.
 * The chart reads a single version, so two rulers are never averaged together.
 *
 * `skillLevels` holds only the skills the window gave an opportunity for, as
 * `{ "<skill key>": level }` — an absent key means "not assessable here", not a
 * low score. `compositeScore` is their mean (1–4), NULL when nothing was
 * assessable. The behaviour codes that produced each level are kept in
 * `verdicts`, so any level can be re-derived or audited without calling the
 * model again; the evidence quotes themselves are not stored.
 */
@Entity('foundational_skill_assessments')
@Index(
  'UQ_foundational_skill_assessments_cut_version',
  ['cutId', 'rubricVersion'],
  {
    unique: true,
  },
)
export class FoundationalSkillAssessment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  cutId!: string;

  @Column({ type: 'varchar', length: 64 })
  rubricVersion!: string;

  @Column({ type: 'varchar', length: 16, enum: FhsAssessmentStatus })
  status!: FhsAssessmentStatus;

  @Column({ type: 'smallint', default: 1 })
  attempts!: number;

  /** The model that actually produced the scores. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  model!: string | null;

  @Column({ type: 'numeric', precision: 4, scale: 2, nullable: true })
  compositeScore!: string | null;

  /** Any assessed skill scored 1 (an unhelpful behaviour was seen). */
  @Column({ type: 'boolean', nullable: true })
  hasUnhelpfulBehaviour!: boolean | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  skillLevels!: Record<string, number>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  verdicts!: StoredSkillVerdict[];

  /** Ticks thrown out because their line or quote did not check out. */
  @Column({ type: 'int', default: 0 })
  droppedTicks!: number;

  @Column({ type: 'int', nullable: true })
  promptTokens!: number | null;

  @Column({ type: 'int', nullable: true })
  completionTokens!: number | null;

  /** Last failure, for a FAILED row. Never transcript text. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  scoredAt!: Date | null;
}
