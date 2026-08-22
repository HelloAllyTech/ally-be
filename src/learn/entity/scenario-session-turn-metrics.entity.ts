import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per agent turn — the latency fact table behind the "time between
 * turns" Metabase dashboards. `responseLatencyMs` is the headline metric
 * (user stops speaking -> agent's FIRST audio, which is the thinking-filler or
 * predictive interim reply when one played); the remaining *Ms columns break
 * that down so a bottleneck can be pinpointed. Populated from the
 * ally-ai-learn `turn_metrics` SQS message (see TurnMetricsProcessor).
 *
 * Because a filler can front-run the real reply, `metadata->>'firstAudioSource'`
 * ('filler' | 'interim' | 'reply') says what was counted, and on masked turns
 * `metadata->>'replyLatencyMs'` carries the unmasked time to the real reply.
 * Any trend chart on responseLatencyMs should split by firstAudioSource —
 * otherwise a rise in filler coverage reads as a latency improvement.
 *
 * Append-only and wide-by-design (one column per stage) so Metabase can chart
 * percentiles / stacked component breakdowns without pivoting an EAV table.
 */
// One row per (session, turn, source). The write path is a blind insert behind
// an at-least-once SQS queue whose processor rethrows on failure, so without
// this a redelivery silently doubled a turn and every aggregate over it. The
// `source` column is part of the key on purpose: live and transcript-derived
// rows for the same turn are two different measurements and both are kept.
@Index(
  'scenario_session_turn_metrics_session_turn_source_uq',
  ['scenarioSessionId', 'turnIndex', 'source'],
  { unique: true },
)
@Index('scenario_session_turn_metrics_session_id_idx', ['scenarioSessionId'])
@Index('scenario_session_turn_metrics_occurred_at_idx', ['occurredAt'])
@Index('scenario_session_turn_metrics_scenario_id_idx', ['scenarioId'])
@Entity('scenario_session_turn_metrics')
export class ScenarioSessionTurnMetrics extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Correlation -----------------------------------------------------------
  @Column({ type: 'uuid', nullable: true })
  scenarioSessionId?: string;

  @Column()
  roomId!: string;

  @Column()
  turnIndex!: number;

  @Column({ nullable: true })
  invocationId?: string;

  // Headline metric -------------------------------------------------------
  /** user_speech_end -> agent_speech_start, in milliseconds. */
  @Column()
  responseLatencyMs!: number;

  // Breakdown (nullable: some stages are skipped / not always measured) ---
  /** End-of-utterance / endpointing delay (LiveKit metrics). */
  @Column({ nullable: true })
  eouDelayMs?: number;

  /**
   * Pure STT finalization time (LiveKit EOUMetrics.transcription_delay):
   * time to obtain the transcript after end of user speech, isolated from
   * VAD-wait/EOU-decision time which eouDelayMs bundles together. Added to
   * pinpoint regional-language STT latency vs. endpointing configuration.
   */
  @Column({ nullable: true })
  sttFinalizeMs?: number;

  /** LLM time-to-first-token (LiveKit metrics). */
  @Column({ nullable: true })
  llmTtftMs?: number;

  /**
   * Raw provider prompt-cache counts for this turn's generate_response LLM
   * call. Kept as raw counts, not a pre-computed rate, so the aggregation
   * method (ratio-of-sums vs. average-of-ratios) stays a query-time
   * decision — see PlatformAnalyticsRepository.getVoiceLatencyByBucket.
   */
  @Column({ nullable: true })
  promptTokens?: number;

  @Column({ nullable: true })
  cachedTokens?: number;

  /** TTS time-to-first-byte (LiveKit metrics). */
  @Column({ nullable: true })
  ttsTtfbMs?: number;

  @Column({ nullable: true })
  orchestrationMs?: number;

  @Column({ nullable: true })
  llmResponseMs?: number;

  /**
   * @deprecated Speech prosody was removed from the voice pipeline; ally-ai-learn
   * no longer emits this and it is no longer populated. Column retained so existing
   * rows and analytics/Metabase queries keep working (new rows are NULL).
   */
  @Column({ nullable: true })
  prosodyMs?: number;

  @Column({ nullable: true })
  branchingMs?: number;

  @Column({ nullable: true })
  knowledgeRetrievalMs?: number;

  /** Total time for the process_events fan-out branch (fan-in bottleneck). */
  @Column({ nullable: true })
  processEventsMs?: number;

  /** Total time for the detect_behaviors fan-out branch (fan-in bottleneck). */
  @Column({ nullable: true })
  behaviorsMs?: number;

  // Dimensions ------------------------------------------------------------
  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  llmModel?: string;

  /**
   * Inference provider for `llmModel` (e.g. 'openai' | 'gemini' | 'anthropic').
   * First-class column (not inferred from the model string) so drift analytics
   * can slice by provider as an experiment dimension. Generation params
   * (temperature / top_p / max_tokens) ride in `metadata`.
   */
  @Column({ nullable: true })
  llmProvider?: string;

  @Column({ nullable: true })
  env?: string;

  @Column({ nullable: true })
  responseChars?: number;

  // Flags -----------------------------------------------------------------
  @Column({ default: 0 })
  eventsDetected!: number;

  /**
   * @deprecated Speech prosody was removed from the voice pipeline; ally-ai-learn
   * no longer emits this and it is no longer populated. Column retained so existing
   * rows and analytics/Metabase queries keep working (new rows default to false).
   */
  @Column({ default: false })
  prosodySkipped!: boolean;

  @Column({ default: false })
  llmTimedOut!: boolean;

  @Column({ default: false })
  interrupted!: boolean;

  // When the turn occurred (from the agent), distinct from createdAt (insert).
  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  /**
   * How this row's metrics were produced:
   *  - 'pipeline'   — emitted live by the agent (full breakdown columns set)
   *  - 'transcript' — derived from scenario_session_messages start/end timings
   *                   (responseLatencyMs only; breakdown columns NULL).
   * Dashboards MUST filter/group by this so the two methods aren't mixed.
   */
  @Column({ default: 'pipeline' })
  source!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
