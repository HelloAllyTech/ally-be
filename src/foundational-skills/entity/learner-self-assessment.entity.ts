import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import { SelfAssessmentTrigger } from '../enum/self-assessment.enum';

/**
 * One answer by a learner to the self-efficacy instrument
 * (`constants/self-efficacy-instrument.constants.ts`): how confident they say
 * they are at each foundational helping skill, 0–10.
 *
 * `responses` is `{ "<rubric skill key>": 0..10 }` holding only the items the
 * learner answered — an absent key is a skipped item, never a zero. An empty
 * object is a dismissed prompt: stored so the cadence resets and the admin
 * coverage can tell "asked and declined" from "never asked". Integers only, no
 * free text, ever.
 *
 * `trigger` says why it was asked; `triggerRef` carries the evidence: for
 * `CUTS` the learner's scored-cut count when they answered (the next `CUTS`
 * prompt is due three scored cuts after it), for `COURSE` the `tracks.id` that
 * was completed, NULL for `ONBOARDING`.
 *
 * `tenant_id` is the learner's org when they answered (BaseEntity), used to
 * scope and to drop test orgs at read time. `answeredAt` is server time.
 * Append-only: a learner's answers are never edited, so first vs latest stays
 * a real before/after. CHECK constraints and indexes live in migration
 * 1975710000000 only.
 */
@Entity('learner_self_assessments')
@Index('IDX_learner_self_assessments_user_answered', ['userId', 'answeredAt'])
export class LearnerSelfAssessment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The learner (`users.id`; the same id as `scenario_sessions.counselorId`). */
  @Column({ type: 'int' })
  userId!: number;

  /** `SELF_EFFICACY_INSTRUMENT_VERSIONS` entry the learner was shown. */
  @Column({ type: 'varchar', length: 32 })
  instrumentVersion!: string;

  @Column({ type: 'varchar', length: 16, enum: SelfAssessmentTrigger })
  trigger!: SelfAssessmentTrigger;

  @Column({ type: 'varchar', length: 64, nullable: true })
  triggerRef!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  responses!: Record<string, number>;

  @Column({ type: 'timestamp' })
  answeredAt!: Date;
}
