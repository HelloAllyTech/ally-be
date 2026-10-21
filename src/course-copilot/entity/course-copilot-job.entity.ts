import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  CourseCopilotJobKind,
  CourseCopilotJobStatus,
} from '../enum/course-copilot.enum';
import { CourseCopilotJobResult } from '../type/course-copilot.type';

/**
 * One unit of build work — usually one course item.
 *
 * Rows, not an in-memory queue, because ally-be runs several ECS tasks and a
 * deploy replaces them mid-build: whatever survives has to be in the database.
 * A job claims itself with a conditional UPDATE (`queued` → `running`), so two
 * runners that overlap after a restart cannot both run it, and it writes its
 * `result` in the same statement that marks it `done`.
 *
 * `heartbeatAt` moves every 30 s while a job runs; the reconcile tick fails a
 * `running` job whose heartbeat is older than ten minutes, keeping `attempts`
 * so a retry is still possible.
 */
@Entity('course_copilot_jobs')
@Index('idx_course_copilot_jobs_session_status', ['sessionId', 'status'])
export class CourseCopilotJob extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 24, enum: CourseCopilotJobKind })
  kind!: CourseCopilotJobKind;

  /** The blueprint item this job realises; null for course-wide jobs. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  blueprintItemId?: string | null;

  /** Jobs that must be `done` first. Any of them failing skips this one. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  dependsOn!: string[];

  @Column({
    type: 'varchar',
    length: 16,
    enum: CourseCopilotJobStatus,
    default: CourseCopilotJobStatus.QUEUED,
  })
  status!: CourseCopilotJobStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  /**
   * The blueprint node plus anything the trainer supplied. Edit-mode jobs also
   * carry `placement {trackSectionId, afterTrackItemId}` (where to insert into
   * the live course) or `replaceTrackItemId` (regenerate in place).
   */
  @Column({ type: 'jsonb' })
  input!: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  result?: CourseCopilotJobResult | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /** Filled from usage after completion (best effort). */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  heartbeatAt?: Date | null;
}
