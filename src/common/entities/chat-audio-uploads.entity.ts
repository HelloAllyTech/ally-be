import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { BaseEntity } from './base.entity';

export enum ChatAudioUploadStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('chat_audio_uploads')
export class ChatAudioUploads extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer' })
  chatId!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  storageKey?: string | null;

  @Column({
    type: 'varchar',
    length: 50,
    default: ChatAudioUploadStatus.PENDING,
  })
  status!: ChatAudioUploadStatus;

  @Column({ type: 'integer', nullable: true })
  sampleRate?: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  format?: string | null;
}
