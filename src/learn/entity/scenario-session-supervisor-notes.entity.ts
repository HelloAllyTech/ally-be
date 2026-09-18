import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per live supervisor note — the short coaching hints the AI supervisor
 * streams into the learner's session sidebar WHILE the roleplay is running
 * (per-scenario `metadata.supervisorNotesEnabled`, default off). Written live
 * from the ally-ai-learn `supervisor_note` SQS message; the same notes are also
 * pushed to the browser over the LiveKit data channel (topic "supervisor"), so
 * this table is the durable record, not the delivery path.
 *
 * Why its own table rather than a jsonb append
 * -------------------------------------------
 * `scenario_session_details` was the obvious host, but notes arrive mid-session
 * and that row may not exist yet — and it already has three upsert writers, so
 * concurrent jsonb appends are a lost-update hazard. `scenario_sessions.metadata`
 * would put an append-only ordered log inside a mutable blob. This is an
 * insert-only ordered log of small rows, exactly like scenario_session_messages.
 *
 * `seq` is assigned by the agent (1-based, per session) and is what makes SQS
 * redelivery idempotent via the unique (scenarioSessionId, seq) index — retries
 * hit the conflict instead of duplicating a note. It is also the read order for
 * the post-session debrief, which is handed these notes as context so the final
 * note can say "as I mentioned during the session…".
 */
@Index('scenario_session_supervisor_notes_session_id_idx', [
  'scenarioSessionId',
])
@Index(
  'scenario_session_supervisor_notes_session_seq_idx',
  ['scenarioSessionId', 'seq'],
  { unique: true },
)
@Entity('scenario_session_supervisor_notes')
export class ScenarioSessionSupervisorNotes extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /** Agent-assigned, 1-based per session. Read order, and the idempotency key. */
  @Column()
  seq!: number;

  /** The coaching hint, already written in the session's language. */
  @Column({ type: 'text' })
  note!: string;

  /**
   * Conversation turn the note was prompted by. Nullable because it is only a
   * correlation aid — a note is never rejected for lacking one.
   */
  @Column({ nullable: true })
  turnIndex?: number;

  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  env?: string;
}
