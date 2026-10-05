import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { HelplineChatEventType } from '../constants/helpline.constants';
import { HelplineTenantScopedEntity } from './helpline-base';

/** The chat's timeline. `payload` carries ids, levels and reasons — never a message body. */
@Entity('helpline_chat_events')
@Index('idx_helpline_chat_events_chat', ['chatId', 'createdAt'])
export class HelplineChatEvent extends HelplineTenantScopedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'chat_id' })
  chatId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: HelplineChatEventType;

  @Column({ type: 'int', name: 'actor_user_id', nullable: true })
  actorUserId!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;
}
