import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { FeedbackSkillLinkStatus } from '../enum/feedback-skill-link.enum';

/** One debrief improvement as stored: its position, and the skill it was filed under. */
export interface StoredFeedbackSkillItem {
  /**
   * 0-based position in the debrief's improvement list —
   * `scenario_session_details.summary.feedback.areasOfGrowth[index]`, or
   * `.improvements[index]` on debriefs written before `areasOfGrowth` existed
   * (the two lists are index-aligned wherever both are present).
   */
  index: number;
  /** An `FHS_RUBRIC` key, or null when no skill fits the item. */
  skill: string | null;
}

/**
 * Which foundational helping skill each "area of growth" in ONE session's
 * debrief asks the learner to work on, under one mapper version
 * (`FEEDBACK_SKILL_MAPPER_VERSION`).
 *
 * Keyed `(scenarioSessionId, mapperVersion)`, so a version bump maps every
 * session again and leaves the old rows. `items` holds one entry per
 * improvement, by position — **never the improvement text**: the text already
 * lives in the debrief, and this table must not become a second copy of
 * anything a learner said or was told. `error` holds a failure or skip reason
 * only.
 *
 * `userId`, `tenant_id` and `sessionEndedAt` are the session's, copied so the
 * analytics read (GET /v1/analytics/foundational-skills/feedback-uptake) can
 * pair a session with the learner's cuts either side without re-reading
 * `scenario_sessions`; `tenant_id` also drops test orgs at read time. No FK to
 * `scenario_sessions` (like the FHS tables). CHECK constraints and indexes live
 * in migration 1975700000000 only.
 */
@Entity('session_feedback_skill_links')
@Index(
  'UQ_session_feedback_skill_links_session_version',
  ['scenarioSessionId', 'mapperVersion'],
  { unique: true },
)
export class SessionFeedbackSkillLink extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /** The learner (`scenario_sessions.counselorId`). */
  @Column({ type: 'int' })
  userId!: number;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'timestamp' })
  sessionEndedAt!: Date;

  @Column({ type: 'varchar', length: 32 })
  mapperVersion!: string;

  @Column({ type: 'varchar', length: 16, enum: FeedbackSkillLinkStatus })
  status!: FeedbackSkillLinkStatus;

  @Column({ type: 'smallint', default: 1 })
  attempts!: number;

  /** Improvements the debrief carried when this row was written. */
  @Column({ type: 'smallint', default: 0 })
  itemCount!: number;

  /** One entry per improvement when MAPPED; empty otherwise. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  items!: StoredFeedbackSkillItem[];

  /** The model that actually produced the mapping. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  model!: string | null;

  @Column({ type: 'int', nullable: true })
  promptTokens!: number | null;

  @Column({ type: 'int', nullable: true })
  completionTokens!: number | null;

  /** Why a FAILED attempt failed, or why the session was SKIPPED. Never debrief text. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  mappedAt!: Date | null;
}
