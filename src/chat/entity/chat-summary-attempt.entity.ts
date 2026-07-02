import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

/**
 * Ordered ladder of pipeline phases a scribe session passes through. Recorded
 * as the FURTHEST phase a given attempt reached, so failure analytics can show
 * a drop-off funnel (how many sessions got at least to each phase, and where
 * they stopped). Spans both services: `created` and `audio-uploaded` are
 * ally-be-side (capture), the rest mirror ally-ai's PipelineStage.
 */
export enum ScribePhaseReached {
  CREATED = 'created',
  AUDIO_UPLOADED = 'audio-uploaded',
  TRANSCRIBED = 'transcribed',
  DIARIZED = 'diarized',
  SUMMARIZED = 'summarized',
  DELIVERED = 'delivered',
}

/** What triggered a given pipeline attempt for a chat. */
export enum ScribeAttemptTrigger {
  /** The original run after the session ended. */
  INITIAL = 'initial',
  /** The auto-retry cron regenerating the summary from a stored transcript. */
  CRON_RETRY = 'cron-retry',
  /** A user pressing "Retry summary". */
  MANUAL_RETRY = 'manual-retry',
  /** The reprocess backfill re-dispatching the chat for re-transcription. */
  REPROCESS = 'reprocess',
}

/** Terminal outcome of a single attempt. */
export enum ScribeAttemptOutcome {
  SUCCESS = 'success',
  FAILED = 'failed',
}

/** One entry in the per-attempt STT provider trail (assigned/tried + result). */
export interface ScribeSttAttempt {
  provider: string;
  ok: boolean;
  error?: string;
}

/**
 * Append-only history of every summary-pipeline attempt for a chat (initial run,
 * cron/manual summary retry, reprocess re-transcription). One row per attempt —
 * nothing is ever overwritten — so analytics can derive first-attempt vs final
 * outcomes, retry volume, per-STT-provider and per-LLM-model rates, and the
 * phase drop-off funnel, none of which survive on the single mutable
 * `chats.summaryStatus` column once a retry heals a session.
 */
@Entity('chat_summary_attempts')
@Index('idx_chat_summary_attempts_chatId', ['chatId'])
@Index('idx_chat_summary_attempts_created', ['createdAt'])
export class ChatSummaryAttempt extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  chatId!: number;

  /** 1-based attempt counter for this chat (initial = 1). */
  @Column({ type: 'integer', default: 1 })
  attemptNo!: number;

  @Column({ type: 'varchar', length: 20 })
  trigger!: ScribeAttemptTrigger;

  @Column({ type: 'varchar', length: 20 })
  outcome!: ScribeAttemptOutcome;

  /** Furthest pipeline phase this attempt reached. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phaseReached?: ScribePhaseReached | null;

  /** Pipeline stage the failure occurred in (e.g. transcribe, summarize). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  failureStage?: string | null;

  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  /** STT provider this session was assigned (rationing); null when unrationed. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sttProviderAssigned?: string | null;

  /** STT provider that actually produced the transcript. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sttProviderSucceeded?: string | null;

  /** Per-provider trail for this attempt (which providers were tried + result). */
  @Column({ type: 'jsonb', nullable: true })
  sttAttempts?: ScribeSttAttempt[] | null;

  /** LLM model used for the summary (e.g. gpt-4o-mini-...). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  summaryModel?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date | null;

  @Column({ type: 'integer', nullable: true })
  elapsedMs?: number | null;

  @Column({ type: 'varchar', nullable: true })
  correlationId?: string | null;
}
