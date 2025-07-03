import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';
import { FlattenedSummaryNotePayloadCamelCase } from './type/call.details.type';
import { CallInfo } from '../../chat/dto/call-log.response.dto';

@Entity('call_details')
export class CallDetails extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('chatId_idx')
  @Column({ type: 'int' })
  chatId!: number;

  @Column({ type: 'int', nullable: true })
  callDuration?: number; // in seconds

  @Column({ type: 'timestamp', nullable: true })
  startTime?: Date;

  @Column({ type: 'timestamp', nullable: true })
  endTime?: Date;

  @Column({ type: 'int', nullable: true })
  noOfNudges?: number;

  @Column({ type: 'int', nullable: true })
  noOfStages?: number;

  @Column({ type: 'text', nullable: true })
  transcript?: string; // Transcript as a single text

  @Column({ type: 'jsonb', nullable: true })
  summary?: FlattenedSummaryNotePayloadCamelCase;

  @Column({ type: 'text', nullable: true })
  callOutcome?: string; // Outcome of thse call

  @Column({ type: 'jsonb', nullable: true })
  callInfo?: CallInfo; // Additional information about the call
}
