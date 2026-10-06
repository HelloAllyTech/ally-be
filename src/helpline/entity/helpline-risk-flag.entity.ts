import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  HelplineRiskFlagLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
  HelplineRiskSubject,
} from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * One risk signal on one talker message. Stores OFFSETS into the message body,
 * never the matched text (invariant 5) — the live `signal` is re-derived from
 * the body for the listener and is null once the body is erased.
 */
@Entity('helpline_risk_flags')
@Index('idx_helpline_risk_flags_chat', ['tenantId', 'chatId'])
@Index('idx_helpline_risk_flags_created', ['tenantId', 'createdAt'])
export class HelplineRiskFlag extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string;

  @Column({ type: 'int', name: 'message_id' })
  messageId!: number;

  @Column({ type: 'varchar', length: 16 })
  level!: HelplineRiskFlagLevel;

  @Column({ type: 'varchar', length: 16 })
  source!: HelplineRiskSource;

  @Column({ type: 'real', nullable: true })
  confidence!: number | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  subject!: HelplineRiskSubject | null;

  @Column({ type: 'uuid', name: 'rule_id', nullable: true })
  ruleId!: string | null;

  @Column({ type: 'int', name: 'signal_start', nullable: true })
  signalStart!: number | null;

  @Column({ type: 'int', name: 'signal_end', nullable: true })
  signalEnd!: number | null;

  @Column({ type: 'boolean', name: 'resources_sent', default: false })
  resourcesSent!: boolean;

  @Column({ type: 'int', name: 'acknowledged_by', nullable: true })
  acknowledgedBy!: number | null;

  @Column({ type: 'timestamptz', name: 'acknowledged_at', nullable: true })
  acknowledgedAt!: Date | null;

  @Column({
    type: 'varchar',
    length: 16,
    default: HelplineRiskOutcome.UNREVIEWED,
  })
  outcome!: HelplineRiskOutcome;

  /** Encrypted at rest; ≤ 500 characters of plaintext. Blanked by retention. */
  @Column({ type: 'text', name: 'outcome_note', nullable: true })
  outcomeNote!: string | null;
}
