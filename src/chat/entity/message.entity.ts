import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from '../../common/entity/base.entity';

export enum MessageType {
  TEXT = 'TEXT',
  SYSTEM = 'SYSTEM',
  NUDGE = 'NUDGE',
  STAGE = 'STAGE',
}

@Entity('messages')
export class Message extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  chatId!: number;

  @Column({ nullable: true })
  senderId?: number;

  @Column()
  type!: MessageType;

  @Column()
  content!: string;

  @Column({ nullable: true })
  context?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ nullable: true })
  parentMessageId?: number;

  @Column({ type: 'float', nullable: true })
  startSeconds?: number;

  @Column({ type: 'float', nullable: true })
  endSeconds?: number;
}
