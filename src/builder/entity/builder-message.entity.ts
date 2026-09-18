import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderMessageRole } from '../enum/builder.enum';

/**
 * PRD-interview transcript. No soft delete — history is immutable so a turn
 * can be replayed into the Anthropic messages array faithfully (text +
 * tool_use + tool_result blocks reconstructed from the jsonb columns).
 *
 * Append-only with one exception: the assistant row for the turn that is
 * currently streaming is allocated empty and rewritten as the turn progresses
 * (see BuilderMessageRepository.checkpointMessage), so a restart mid-turn does
 * not lose minutes of tool work. `metadata.streaming` is true for exactly that
 * row; once it is false the row is history and never changes again.
 *
 * `seq` is unique per session (allocated from builder_sessions.lastMessageSeq)
 * and is what the `done {messageSeq}` SSE frame reports.
 */
@Entity('builder_messages')
@Index('idx_builder_messages_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
@Index('idx_builder_messages_session_id', ['sessionId'])
export class BuilderMessage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ enum: BuilderMessageRole })
  role!: BuilderMessageRole;

  @Column({ type: 'text', nullable: true })
  content?: string | null;

  /** Assistant tool invocations this turn: [{ id, name, input }]. */
  @Column({ type: 'jsonb', nullable: true })
  toolCalls?: Record<string, any>[] | null;

  /** Results fed back per tool call: [{ toolUseId, name, result }]. */
  @Column({ type: 'jsonb', nullable: true })
  toolResults?: Record<string, any>[] | null;

  /**
   * model / stopReason / iterations, the `questions` asked this turn (so a
   * resumed chat rebuilds the cards), and on user rows the raw `answer`
   * payload behind the flattened content string.
   *
   * `streaming: true` marks an assistant row whose turn is still running;
   * `interrupted: true` marks one whose turn never came back.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
