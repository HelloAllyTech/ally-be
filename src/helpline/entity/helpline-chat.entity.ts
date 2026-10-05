import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  HelplineChannel,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplineQaStatus,
  HelplineRiskLevel,
} from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * One conversation, and also the queue: a chat with `status = 'WAITING'` IS a
 * queue entry, which is what makes the claim a single conditional UPDATE
 * (contract §6.6). Separate from `chats` because that table is read raw by the
 * Scribe analytics and call-log services (contract §1).
 */
@Entity('helpline_chats')
@Index('idx_helpline_chats_queue', [
  'tenantId',
  'status',
  'priority',
  'waitStartedAt',
])
@Index('idx_helpline_chats_listener', ['tenantId', 'listenerId', 'status'])
@Index('idx_helpline_chats_talker', ['talkerId'])
export class HelplineChat extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'talker_id' })
  talkerId!: string;

  @Column({ type: 'varchar', length: 16, default: HelplineChannel.TEXT_WEB })
  channel!: HelplineChannel;

  @Column({ type: 'varchar', length: 16, default: HelplineChatStatus.WAITING })
  status!: HelplineChatStatus;

  @Column({ type: 'varchar', length: 8 })
  language!: string;

  /** 100 once a WAITING chat is HIGH risk; sorts the lobby. */
  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ type: 'timestamptz', name: 'wait_started_at' })
  waitStartedAt!: Date;

  /** Talker gone while WAITING: hidden from the lobby, revivable for 10 min. */
  @Column({ type: 'timestamptz', name: 'abandoned_at', nullable: true })
  abandonedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'claimed_at', nullable: true })
  claimedAt!: Date | null;

  @Column({ type: 'int', name: 'listener_id', nullable: true })
  listenerId!: number | null;

  /** Read-only access after a transfer or take-over. */
  @Column({
    type: 'int',
    array: true,
    name: 'previous_listener_ids',
    default: () => "'{}'",
  })
  previousListenerIds!: number[];

  @Column({
    type: 'timestamptz',
    name: 'transfer_requested_at',
    nullable: true,
  })
  transferRequestedAt!: Date | null;

  @Column({ type: 'int', name: 'transfer_requested_by', nullable: true })
  transferRequestedBy!: number | null;

  @Column({ type: 'int', name: 'transfer_target_listener_id', nullable: true })
  transferTargetListenerId!: number | null;

  @Column({ type: 'timestamptz', name: 'taken_over_at', nullable: true })
  takenOverAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'varchar', length: 32, name: 'ended_reason', nullable: true })
  endedReason!: HelplineEndedReason | null;

  @Column({ type: 'int', name: 'ended_by', nullable: true })
  endedBy!: number | null;

  /** Denormalised max over the chat's risk flags; only ever rises. */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'risk_level',
    default: HelplineRiskLevel.NONE,
  })
  riskLevel!: HelplineRiskLevel;

  @Column({ type: 'timestamptz', name: 'resources_sent_at', nullable: true })
  resourcesSentAt!: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'last_talker_message_at',
    nullable: true,
  })
  lastTalkerMessageAt!: Date | null;

  @Column({
    type: 'timestamptz',
    name: 'last_listener_message_at',
    nullable: true,
  })
  lastListenerMessageAt!: Date | null;

  @Column({ type: 'int', name: 'talker_message_count', default: 0 })
  talkerMessageCount!: number;

  @Column({ type: 'int', name: 'listener_message_count', default: 0 })
  listenerMessageCount!: number;

  @Column({ type: 'int', name: 'talker_turns_since_nudge', default: 0 })
  talkerTurnsSinceNudge!: number;

  @Column({ type: 'int', name: 'nudge_count', default: 0 })
  nudgeCount!: number;

  @Column({ type: 'varchar', length: 16, name: 'qa_status', nullable: true })
  qaStatus!: HelplineQaStatus | null;

  @Column({ type: 'timestamptz', name: 'erased_at', nullable: true })
  erasedAt!: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;
}
