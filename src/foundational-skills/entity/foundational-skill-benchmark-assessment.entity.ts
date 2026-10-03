import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { FhsBenchmarkStatus } from '../enum/foundational-skills.enum';
import { StoredSkillVerdict } from './foundational-skill-assessment.entity';

/**
 * The foundational-skills judgement of ONE WHOLE completed session of a
 * benchmark roleplay (`scenarios.metadata.fhsBenchmark = true`), under one
 * rubric version.
 *
 * Same ruler as `FoundationalSkillAssessment` — the same rubric, judge prompt
 * and pinned model, with levels derived in code the same way — but the unit is
 * a session of a fixed scenario rather than a 5,000-character cut of whatever
 * the learner practised. Comparing a learner's first and latest benchmark
 * sessions holds the scenario constant, which cut-to-cut comparison cannot.
 *
 * Keyed `(sessionId, rubricVersion)`, so a version bump re-scores every
 * benchmark session and leaves the old rows. `skillLevels` holds only skills
 * the session gave an opportunity for (absent key = no opportunity, not a low
 * score); `compositeScore` is their mean, NULL when nothing was assessable.
 *
 * `cutsBefore` is the learner's practice dose when the session ended: sealed
 * cuts whose `closedSessionEndedAt` is at or before `sessionEndedAt`. It is
 * recounted every scheduler tick, because cutting can lag scoring.
 *
 * `tenant_id` is the session's tenant, used only to drop test organisations at
 * read time. No FK to `scenario_sessions` (like the cut table). Nothing here
 * copies transcript text: `learnerChars` is a length, and `error` holds a
 * failure or skip reason only. CHECK constraints and indexes live in migration
 * 1975400000000 only.
 */
@Entity('foundational_skill_benchmark_assessments')
@Index(
  'UQ_foundational_skill_benchmark_assessments_session_version',
  ['sessionId', 'rubricVersion'],
  { unique: true },
)
export class FoundationalSkillBenchmarkAssessment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** The learner (`scenario_sessions.counselorId`). */
  @Column({ type: 'int' })
  userId!: number;

  /** The benchmark roleplay (`scenarios.id`). */
  @Column({ type: 'int' })
  scenarioId!: number;

  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'timestamp' })
  sessionEndedAt!: Date;

  @Column({ type: 'varchar', length: 64 })
  rubricVersion!: string;

  @Column({ type: 'varchar', length: 16, enum: FhsBenchmarkStatus })
  status!: FhsBenchmarkStatus;

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

  /** The learner's own speech in the session, in code points. */
  @Column({ type: 'int', default: 0 })
  learnerChars!: number;

  /** Sealed cuts the learner had when this session ended (practice dose). */
  @Column({ type: 'int', default: 0 })
  cutsBefore!: number;

  /** Why a FAILED attempt failed, or why the session was SKIPPED. Never transcript text. */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  scoredAt!: Date | null;
}
