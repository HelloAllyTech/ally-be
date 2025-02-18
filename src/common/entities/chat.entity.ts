import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

// You'll need to create this enum to match the Python ChatStatus
export enum ChatStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  PAUSED = 'PAUSED',
  // Add other chat statuses as needed
}

@Entity('chats')
export class Chat extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  roomId!: number;

  @Column()
  clientId!: number;

  @Column({ nullable: true })
  counselorId?: number;

  @Column({ default: ChatStatus.ACTIVE })
  status!: ChatStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endedAt?: Date;

  @Column({ nullable: true })
  summary?: string;
}
