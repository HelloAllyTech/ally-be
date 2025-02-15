import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Chat } from './chat.entity';
import { BaseEntity } from './base.entity';

export enum MessageType {
  TEXT = 'TEXT',
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
}
