import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One fixed slice of a learner's own speech in roleplay practice — the unit the
 * foundational-skills measure is taken on.
 *
 * A learner's completed sessions, in the order they ended, are read as one
 * stream; a cut closes on the helper turn that brings the learner's speech to
 * `FHS_CUT_LEARNER_CHARS`. Cut 1 is their first 5,000 characters, cut 2 the
 * next, and so on — so "cut N" means the same amount of practice for everyone,
 * whatever scenarios filled it.
 *
 * Cuts are **append-only and rubric-independent**: once sealed a cut is never
 * redrawn, and a new rubric version re-scores the same cuts rather than
 * re-cutting (see `FoundationalSkillAssessment`). Nothing here copies
 * transcript text; the window is re-read from `scenario_session_messages` by
 * its bounds whenever it is scored.
 *
 * `tenant_id` is the tenant of the session the cut closed in — used only to
 * drop test organisations at read time. No soft delete. The CHECK constraints
 * and indexes live in migration 1974600000000 only.
 */
@Entity('foundational_skill_cuts')
@Index('UQ_foundational_skill_cuts_user_cut', ['userId', 'cutIndex'], {
  unique: true,
})
export class FoundationalSkillCut extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The learner (`scenario_sessions.counselorId`). */
  @Column({ type: 'int' })
  userId!: number;

  /** 1-based position in the learner's stream. */
  @Column({ type: 'int' })
  cutIndex!: number;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId!: string | null;

  /** Every session the cut touches, in consumption order. */
  @Column({ type: 'uuid', array: true })
  sessionIds!: string[];

  @Column({ type: 'uuid' })
  startSessionId!: string;

  /** `scenario_session_messages.id` of the first turn in the cut. */
  @Column({ type: 'int' })
  startMessageId!: number;

  @Column({ type: 'uuid' })
  endSessionId!: string;

  /** `scenario_session_messages.id` of the helper turn that closed the cut. */
  @Column({ type: 'int' })
  endMessageId!: number;

  @Column({ type: 'boolean' })
  startsMidSession!: boolean;

  /** True when the rest of `endSessionId` carries into the next cut. */
  @Column({ type: 'boolean' })
  endsMidSession!: boolean;

  /** Learner speech in the cut, in code points. Always >= the threshold. */
  @Column({ type: 'int' })
  learnerChars!: number;

  /** Learner plus character speech, fillers and interim replies excluded. */
  @Column({ type: 'int' })
  totalChars!: number;

  /** When the session the cut closed in ended — the cut's place in time. */
  @Column({ type: 'timestamp' })
  closedSessionEndedAt!: Date;
}
