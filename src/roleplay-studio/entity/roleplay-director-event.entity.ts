import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoleplayDirectorEventType } from '../enum/director-event-type.enum';

/**
 * Telemetry fact table for the roleplay v2 director: one row per director SQS
 * message (state transitions, rubric scoring turns, disclosure unlocks, stage
 * directions, the end-of-session summary). Written by the SQS processors in
 * src/roleplay-studio/processor/; resolved to a session by room_id. No soft
 * delete — telemetry is append-only.
 */
@Entity('roleplay_director_events')
@Index('idx_roleplay_director_events_session_id', ['scenarioSessionId'])
@Index('idx_roleplay_director_events_room_id', ['roomId'])
export class RoleplayDirectorEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Loose FK to scenario_sessions.id (resolved from room_id).
  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column()
  roomId!: string;

  @Column({ enum: RoleplayDirectorEventType })
  eventType!: RoleplayDirectorEventType;

  @Column({ type: 'int', nullable: true })
  turnIndex?: number | null;

  // The raw `data` block of the SQS envelope, verbatim.
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload!: Record<string, any>;

  // Outer envelope timestamp (unix seconds → Date).
  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date | null;
}
