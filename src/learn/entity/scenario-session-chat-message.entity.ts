import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * senderId convention:
 *   - User's integer ID (e.g., 42) — message sent by the user
 *   - -1 — message sent by the AI assistant
 */
@Index('idx_scenario_session_chat_messages_chat_id', ['chatId'])
@Entity('scenario_session_chat_messages')
export class ScenarioSessionChatMessage extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  chatId!: string;

  @Column('int')
  senderId!: number;

  @Column({ type: 'text' })
  content!: string;
}
