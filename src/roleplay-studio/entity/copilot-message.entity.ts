import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';

/**
 * Append-only copilot transcript. No soft delete — history is immutable so a
 * turn can be replayed into the Anthropic messages array faithfully
 * (text + tool_use + tool_result blocks reconstructed from the jsonb columns).
 *
 * `seq` is unique per session (allocated from copilot_sessions.lastMessageSeq)
 * and is what the `done {messageSeq}` SSE frame reports.
 */
@Entity('copilot_messages')
@Index('idx_copilot_messages_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
@Index('idx_copilot_messages_session_id', ['sessionId'])
export class CopilotMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ enum: CopilotMessageRole })
  role!: CopilotMessageRole;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  // Assistant tool invocations this turn: [{ id, name, input }].
  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  // Results fed back for each tool call: [{ toolUseId, name, result }].
  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  // RFC-6902 patches APPLIED to the draft during this turn:
  // [{ patchId, summary, ops, specVersionId }]. Applied patches survive an
  // aborted turn — they are persisted at tool-execution time, this column is
  // the per-message record of them.
  @Column({ type: 'jsonb', nullable: true })
  specDiff?: Record<string, any>[] | null;

  // Token usage & misc (model, stopReason, iterations, questions asked…).
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
