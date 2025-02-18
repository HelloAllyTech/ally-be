import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';
@Entity('chat_rooms')
export class ChatRoom extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ nullable: true })
  description?: string;

  @Column()
  clientId!: number;

  @Column({ nullable: true })
  counselorId?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
