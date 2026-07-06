import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index('scenario_session_details_scenario_session_id_idx', [
  'scenarioSessionId',
])
@Entity('scenario_session_details')
export class ScenarioSessionDetails extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int', nullable: true })
  callDuration?: number; // in seconds

  @Column({ type: 'jsonb', nullable: true })
  summary?: Record<string, any>;

  // --- Actor-agent evaluation (LLM judge over the real-session transcript,
  // scored against the superadmin-configured agent test cases). Populated
  // asynchronously after the session ends via the evaluation webhook. ---

  /** Goal/metric name -> 0-100 score (e.g. {"Build rapport": 82}). */
  @Column({ type: 'jsonb', nullable: true })
  metrics?: Record<string, number>;

  /** round(mean(metrics values)); the headline actor-quality number. */
  @Column({ type: 'int', nullable: true })
  compositeScore?: number;

  /** Human-readable judge feedback (markdown). */
  @Column({ type: 'text', nullable: true })
  evaluationMarkdown?: string;

  /** IN_PROGRESS | COMPLETED | FAILED. */
  @Column({ nullable: true })
  evaluationStatus?: string;

  @Column({ type: 'timestamp', nullable: true })
  evaluatedAt?: Date;
}
