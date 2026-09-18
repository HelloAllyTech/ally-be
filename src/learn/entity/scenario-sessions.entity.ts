import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from 'src/common/entity/base.entity';
import {
  ScenarioSessionAbandonReason,
  ScenarioSessionEndReason,
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../enum/scenario-session-status.enum';

@Index('scenario_sessions_counselor_id_idx', ['counselorId'])
@Entity('scenario_sessions')
export class ScenarioSessions extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  roomId!: string;

  @Column()
  scenarioId!: number;

  @Column()
  counselorId!: number;

  @Column({
    enum: ScenarioSessionStatus,
    default: ScenarioSessionStatus.ACTIVE,
  })
  status!: ScenarioSessionStatus;

  @Column({
    enum: ScenarioSessionEventStatus,
    default: ScenarioSessionEventStatus.IN_PROGRESS,
  })
  eventStatus!: ScenarioSessionEventStatus;

  /**
   * Why this session was marked abandoned, when it was. NULL for every session
   * that ran its course — which is the overwhelming majority, hence nullable
   * rather than a defaulted column.
   *
   * A plain ABANDONED status without this would only move the ambiguity: "the
   * room died under a live session" and "this sat ACTIVE for a day and was
   * reaped" want different follow-up, and telling them apart after the fact is
   * impossible from the timestamps alone.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  abandonedReason?: ScenarioSessionAbandonReason | null;

  /**
   * Set only when this ENDED/COMPLETED session was force-exited by
   * ally-ai-learn's stall watchdog rather than shut down cleanly — see
   * `ScenarioSessionEndReason`. NULL for the ordinary case.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  endReason?: ScenarioSessionEndReason | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;

  @Column({ type: 'float', nullable: true })
  score?: number;

  // Pause/resume bookkeeping. `pausedAt` is the start of the currently-open
  // pause (null when running); `totalPausedMs` is the cumulative paused time,
  // reported authoritatively by the agent and subtracted from billed/limited
  // duration so paused time costs the user nothing.
  @Column({ type: 'timestamp', nullable: true })
  pausedAt?: Date | null;

  @Column({ type: 'int', default: 0 })
  totalPausedMs?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  // The scenario_versions row this session ran against. Studio test runs set
  // it to the version under test; production sessions default to the
  // scenario's publishedVersionId. Lets reports be attributed to a version.
  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  scenarioPathSessionItemId?: string;

  @Column({ type: 'uuid', nullable: true })
  caseSessionItemId?: string;

  // Track 2.0: the track_item_progress row this session was played for.
  @Column({ type: 'uuid', nullable: true })
  trackItemProgressId?: string;
}
