import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** What kind of mistake an admin had to correct. */
export type BuilderCorrectionCategory =
  /** Builder did not know a system already does this ("this already exists"). */
  | 'missing_capability'
  /** Builder relied on a doc that was wrong or out of date. */
  | 'stale_doc'
  /** A platform or repo was left out or wrongly included (mobile missed). */
  | 'platform_scope'
  /** Builder asked what it could have found, or asked when it had enough. */
  | 'over_asking'
  | 'other';

export const BUILDER_CORRECTION_CATEGORIES: BuilderCorrectionCategory[] = [
  'missing_capability',
  'stale_doc',
  'platform_scope',
  'over_asking',
  'other',
];

/** Where a correction was sent. Drafts only: nothing here is published by itself. */
export interface BuilderCorrectionRoutes {
  /** The general lesson, recorded as a candidate for the lesson curator. */
  lesson?: string | null;
  lessonRecorded?: boolean;
  /** A reuse line for builder-capabilities.constants.ts — code, so a person adds it. */
  capability?: { name: string; whatItIs: string; reuseWhen: string } | null;
  /** A doc fix for a person to make (the wiki and repos are public, so never automatic). */
  doc?: { path?: string | null; fix: string } | null;
  /** The line a correct PRD must (not) contain, added to the session's auto-fixture. */
  checklistItem?: { text: string; kind: 'must' | 'must_not' } | null;
  /** The eval fixture the checklist line went to. */
  fixtureId?: string | null;
}

/**
 * One admin message in a Builder interview, classified: was it a correction,
 * and if so of what, and where did it go.
 *
 * Every candidate message gets a row, corrections or not — that is what makes
 * the daily scan idempotent (`messageId` is unique) and what lets the
 * classifier's precision be measured later. The interesting rows are
 * `isCorrection`, and their count per session is the plan's north star:
 * admin corrections per PRD.
 *
 * No FK to the session, like lessons: what a correction taught outlives the
 * session it came from. Holds production admin text, so it stays in the
 * database and nothing here is ever published automatically.
 */
@Entity('builder_corrections')
@Index('idx_builder_corrections_session', ['sessionId'])
@Index('idx_builder_corrections_message_at', ['messageAt'])
export class BuilderCorrection extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Index('idx_builder_corrections_message', { unique: true })
  @Column({ type: 'uuid' })
  messageId!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  sessionTitle?: string | null;

  /** When the admin said it. */
  @Column({ type: 'timestamp' })
  messageAt!: Date;

  @Column({ type: 'text' })
  adminText!: string;

  /** What Builder had said just before — the thing being corrected. */
  @Column({ type: 'text', nullable: true })
  builderText?: string | null;

  @Column({ type: 'boolean' })
  isCorrection!: boolean;

  @Column({ type: 'varchar', length: 30, nullable: true })
  category?: BuilderCorrectionCategory | null;

  /** The system, doc or platform it was about, in a few words. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  subject?: string | null;

  /** What Builder got wrong, in a sentence. */
  @Column({ type: 'text', nullable: true })
  detail?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  routes?: BuilderCorrectionRoutes | null;

  /** `new` until a person looks; `dismissed` marks a classifier false positive. */
  @Column({ type: 'varchar', length: 20, default: 'new' })
  status!: 'new' | 'reviewed' | 'dismissed';

  @Column({ type: 'text', nullable: true })
  reviewNote?: string | null;

  @Column({ type: 'int', nullable: true })
  reviewedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt?: Date | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model?: string | null;
}
