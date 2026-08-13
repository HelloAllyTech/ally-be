import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CharacterInterviewMessageRole } from '../enum/character-interview.enum';

/**
 * Append-only interview transcript. No soft delete — history is immutable so
 * a turn can be replayed into the Anthropic messages array faithfully
 * (text + tool_use + tool_result blocks reconstructed from the jsonb columns).
 *
 * `seq` is unique per session (allocated from
 * character_interview_sessions.lastMessageSeq) and is what the
 * `done {messageSeq}` SSE frame reports.
 */
@Entity('character_interview_messages')
@Index('idx_character_interview_messages_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
@Index('idx_character_interview_messages_session_id', ['sessionId'])
export class CharacterInterviewMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ enum: CharacterInterviewMessageRole })
  role!: CharacterInterviewMessageRole;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  // Assistant tool invocations this turn: [{ id, name, input }].
  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  // Results fed back for each tool call: [{ toolUseId, name, result }].
  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  // Token usage & misc (model, stopReason, iterations, questions asked…).
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
