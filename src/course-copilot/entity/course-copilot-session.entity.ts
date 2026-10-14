import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  CourseCopilotMode,
  CourseCopilotSessionStatus,
} from '../enum/course-copilot.enum';
import {
  CourseBlueprint,
  CourseBrief,
  CourseCopilotTrackIdMap,
} from '../type/course-copilot.type';

/**
 * One Course Copilot conversation: an interview that becomes a blueprint, a
 * build that fills a DRAFT course from it, and then an edit loop over that
 * course. EDIT-mode sessions start bound to an existing course.
 *
 * The session owns the link to its course (`trackId`); nothing is added to
 * `tracks`. Archiving a session never touches the course it made.
 *
 * `lastMessageSeq` / `lastEventSeq` are monotonic counters bumped atomically
 * (UPDATE … RETURNING) so transcript and event seqs stay gapless and unique
 * per session under concurrent writers — the same primitive Builder and the
 * character interview use.
 */
@Entity('course_copilot_sessions')
@Index('idx_course_copilot_sessions_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_course_copilot_sessions_track_id', ['trackId'])
@Index('idx_course_copilot_sessions_status', ['status'])
export class CourseCopilotSession extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, default: 'New course' })
  title!: string;

  @Column({
    type: 'varchar',
    length: 16,
    enum: CourseCopilotMode,
    default: CourseCopilotMode.CREATE,
  })
  mode!: CourseCopilotMode;

  @Column({
    type: 'varchar',
    length: 24,
    enum: CourseCopilotSessionStatus,
    default: CourseCopilotSessionStatus.INTERVIEWING,
  })
  status!: CourseCopilotSessionStatus;

  /** Set at approval (CREATE) or at session start (EDIT). */
  @Column({ type: 'uuid', nullable: true })
  trackId?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  brief!: CourseBrief;

  /** The latest blueprint; `blueprintVersion` increments on every change. */
  @Column({ type: 'jsonb', nullable: true })
  blueprint?: CourseBlueprint | null;

  @Column({ type: 'int', default: 0 })
  blueprintVersion!: number;

  /** Frozen copy at approval — what the build realises. */
  @Column({ type: 'jsonb', nullable: true })
  approvedBlueprint?: CourseBlueprint | null;

  /** Blueprint section/item id → the track row the build created for it. */
  @Column({
    type: 'jsonb',
    default: () => `'{"sections":{},"items":{}}'::jsonb`,
  })
  trackIdMap!: CourseCopilotTrackIdMap;

  /** Spend ceiling for the whole session. 0 means uncapped. */
  @Column({ type: 'numeric', precision: 10, scale: 2 })
  budgetUsd!: string;

  /** Roleplays this session created — for provenance and the reviewer. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  generatedScenarioIds!: number[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  generatedCaseIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  generatedCharacterIds!: string[];

  /**
   * `interviewSummary {uptoSeq,text}`, `changeLog[]`,
   * `pendingConfirmation {action, input, questionId}` for a publish/assign/
   * duplicate the model asked about and has not yet had answered.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', default: 0 })
  lastMessageSeq!: number;

  @Column({ type: 'int', default: 0 })
  lastEventSeq!: number;

  /** Owning tenant, or NULL for a platform admin. Kept for the tenant-admin release. */
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
