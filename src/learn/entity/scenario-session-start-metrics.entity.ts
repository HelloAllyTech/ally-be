import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per simulation START — the "time to first word" fact table behind the
 * start-latency analytics chart. `startLatencyMs` is the headline metric (agent
 * job start -> the agent begins its opening dialogue); the segment columns
 * (configureMs / initializeMs / connectMs / prepMs) break it down so the chart
 * can stack WHERE the startup time goes. Populated live from the ally-ai-learn
 * `start_metrics` SQS message (see StartMetricsProcessor).
 *
 * Historical rows are backfilled from scenario_session_messages with
 * source='transcript' — `startLatencyMs` only (from the first agent message's
 * startSeconds), segments NULL. Note the transcript total EXCLUDES the pre-join
 * configure/initialize time (recording starts after the agent joins the room),
 * so dashboards MUST filter/group by `source` and never mix the two methods.
 */
@Index('scenario_session_start_metrics_session_id_idx', ['scenarioSessionId'])
@Index('scenario_session_start_metrics_occurred_at_idx', ['occurredAt'])
@Index('scenario_session_start_metrics_scenario_id_idx', ['scenarioId'])
@Entity('scenario_session_start_metrics')
export class ScenarioSessionStartMetrics extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Correlation -----------------------------------------------------------
  @Column({ type: 'uuid', nullable: true })
  scenarioSessionId?: string;

  @Column()
  roomId!: string;

  // Headline metric -------------------------------------------------------
  /** Agent job start -> the agent begins its opening dialogue, in milliseconds. */
  @Column()
  startLatencyMs!: number;

  // Breakdown (nullable: only 'pipeline' rows carry the segments; the
  // 'transcript' backfill has the total only) ------------------------------
  /** configure(): room-metadata parse + STT/TTS/LLM client creation. */
  @Column({ nullable: true })
  configureMs?: number;

  /** initialize(): session/agent/orchestrator creation (incl. the EOU handle). */
  @Column({ nullable: true })
  initializeMs?: number;

  /** session.start() + room join (LiveKit connect). */
  @Column({ nullable: true })
  connectMs?: number;

  /** Post-connect prep before speaking (orchestrator init + background audio). */
  @Column({ nullable: true })
  prepMs?: number;

  /** Opening statement TTS playout duration (informational; not part of total). */
  @Column({ nullable: true })
  openingPlayoutMs?: number;

  // Dimensions ------------------------------------------------------------
  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  env?: string;

  // When the opening occurred (agent-side), distinct from createdAt (insert).
  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  /**
   * How this row was produced:
   *  - 'pipeline'   — emitted live by the agent (segment columns set)
   *  - 'transcript' — derived from the first agent message's startSeconds
   *                   (startLatencyMs only; segments NULL; excludes pre-join
   *                   configure/initialize time).
   * Dashboards MUST filter/group by this so the two methods aren't mixed.
   */
  @Column({ default: 'pipeline' })
  source!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
