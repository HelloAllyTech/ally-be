import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { QueueStatus } from '../constants/chat.constants';

@Entity('queue_entries')
export class QueueEntry {
  @PrimaryGeneratedColumn({ name: 'entry_id' })
  entryId!: number;

  @Column({ name: 'user_id' })
  clientId!: number;

  @Column({ name: 'chat_id' })
  chatId!: number;

  @Column({ default: 0 })
  priority!: number;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
    name: 'wait_start_time',
  })
  waitStartTime!: Date;

  @Column({
    default: QueueStatus.WAITING,
  })
  status?: QueueStatus;
}
