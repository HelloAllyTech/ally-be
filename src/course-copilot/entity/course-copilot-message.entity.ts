import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CourseCopilotMessageRole } from '../enum/course-copilot.enum';

/**
 * Course Copilot transcript — a copy of `character_interview_messages` /
 * `builder_messages`. No soft delete: history is replayed into the model's
 * message array, so it must stay exactly as it was.
 *
 * Append-only with one exception: the assistant row for the turn that is
 * streaming right now is allocated empty and checkpointed as the turn runs,
 * so a restart mid-turn keeps the tool work already done. `metadata.streaming`
 * is true for exactly that row.
 *
 * The build's reviewer notes are also an assistant row (`metadata.reviewNotes`)
 * with no tool calls, so a resumed chat shows them in place.
 */
@Entity('course_copilot_messages')
@Index('idx_course_copilot_messages_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
@Index('idx_course_copilot_messages_session_id', ['sessionId'])
export class CourseCopilotMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 16, enum: CourseCopilotMessageRole })
  role!: CourseCopilotMessageRole;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /** [{ id, name, input }] */
  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  /** [{ toolUseId, name, result }] */
  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  /**
   * Assistant: provider, model, iterations, stopReason, errored, errorMessage,
   * questions[], blueprintVersion, coursePatches[], reviewNotes, streaming.
   * User: questionId, answer (the raw structured answer behind `content`).
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number | null;
}
