import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Infrastructure lifecycle milestones of a roleplay/simulation session (room
 * created, agent dispatched/joined, participant joined, room finished). These
 * were previously only in the voice worker + backend stdout logs; persisting
 * them powers the per-session timeline in the super-admin session-logs view and
 * makes "the agent never joined" diagnosable from the product (an absent
 * AGENT_JOINED row).
 *
 * Append-only and deliberately standalone (no tenant scoping / soft-delete):
 * the session-logs reader is cross-tenant, and writes happen from webhook
 * handlers that don't always have the tenant resolved. Correlated to a session
 * purely by `scenarioSessionId` (= the room name minus its `ss_` prefix).
 */
export enum ScenarioSessionLifecycleEventType {
  ROOM_CREATED = 'ROOM_CREATED',
  AGENT_DISPATCHED = 'AGENT_DISPATCHED',
  PARTICIPANT_JOINED = 'PARTICIPANT_JOINED',
  AGENT_JOINED = 'AGENT_JOINED',
  // Agent participant left the room. An AGENT_JOINED with a later AGENT_LEFT
  // (before ROOM_FINISHED) is a mid-session drop — distinct from a healthy end.
  AGENT_LEFT = 'AGENT_LEFT',
  RECORDING_STARTED = 'RECORDING_STARTED',
  ROOM_FINISHED = 'ROOM_FINISHED',
}

@Entity('scenario_session_lifecycle_events')
@Index(['scenarioSessionId', 'occurredAt'])
export class ScenarioSessionLifecycleEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'varchar' })
  type!: ScenarioSessionLifecycleEventType;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  /** Small context payload, e.g. participant identity / agent name / egress id. */
  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
