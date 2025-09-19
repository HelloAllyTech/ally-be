import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

// You'll need to create this enum to match the Python ChatStatus
export enum ChatStatus {
  STARTED = 'STARTED',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
}

export enum ChatSummaryStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  NO_AUDIO = 'NO_AUDIO',
}

// TODO: Consider rename table to generic name
// Currently used to store calls
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
  externalId?: string;

  @Column({ default: ChatSummaryStatus.PENDING })
  summaryStatus!: ChatSummaryStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
