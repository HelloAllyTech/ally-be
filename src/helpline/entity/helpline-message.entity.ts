import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  HelplineMessageType,
  HelplineSenderRole,
} from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/**
 * Every line in a chat, talker-visible or not. The int id is monotonic, which
 * is what `afterId` resync relies on.
 *
 * `visible_to_talker` is guarded twice: a DB CHECK
 * (`type IN ('TEXT','SYSTEM') OR visible_to_talker = false`) and the two
 * serialisers in `util/helpline-serializers.ts` — the only way a row reaches a
 * talker.
 */
@Entity('helpline_messages')
@Index('idx_helpline_messages_chat_id', ['chatId', 'id'])
export class HelplineMessage extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string;

  @Column({ type: 'varchar', length: 16, name: 'sender_role' })
  senderRole!: HelplineSenderRole;

  @Column({ type: 'int', name: 'sender_user_id', nullable: true })
  senderUserId!: number | null;

  @Column({ type: 'varchar', length: 16 })
  type!: HelplineMessageType;

  @Column({ type: 'varchar', length: 40, name: 'system_kind', nullable: true })
  systemKind!: string | null;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int', name: 'parent_message_id', nullable: true })
  parentMessageId!: number | null;

  /** Client-generated; unique per chat → a resend returns the existing row. */
  @Column({ type: 'uuid', name: 'client_message_id', nullable: true })
  clientMessageId!: string | null;

  @Column({ type: 'boolean', name: 'visible_to_talker', default: false })
  visibleToTalker!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', name: 'erased_at', nullable: true })
  erasedAt!: Date | null;
}
