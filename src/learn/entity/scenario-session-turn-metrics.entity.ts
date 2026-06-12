import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per agent turn — the latency fact table behind the "time between
 * turns" Metabase dashboards. `responseLatencyMs` is the headline metric
 * (user stops speaking -> agent starts speaking); the remaining *Ms columns
 * break that down so a bottleneck can be pinpointed. Populated from the
 * ally-ai-learn `turn_metrics` SQS message (see TurnMetricsProcessor).
 *
 * Append-only and wide-by-design (one column per stage) so Metabase can chart
 * percentiles / stacked component breakdowns without pivoting an EAV table.
 */
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

  /** LLM time-to-first-token (LiveKit metrics). */
  @Column({ nullable: true })
  llmTtftMs?: number;

  /** TTS time-to-first-byte (LiveKit metrics). */
  @Column({ nullable: true })
  ttsTtfbMs?: number;

  @Column({ nullable: true })
  orchestrationMs?: number;

  @Column({ nullable: true })
  llmResponseMs?: number;

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

  @Column({ nullable: true })
  env?: string;

  @Column({ nullable: true })
  responseChars?: number;

  // Flags -----------------------------------------------------------------
  @Column({ default: 0 })
  eventsDetected!: number;

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
