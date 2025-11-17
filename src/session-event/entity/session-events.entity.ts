import { Column, DeleteDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entity/base-without-tenant.entity';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { SessionEventDetectionType } from '../enum/session-event-detection.enum';

@Entity('session_events')
export class SessionEvents extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ nullable: true })
  score?: number;

  @Column({ nullable: true })
  emoji?: string;

  @Column({ nullable: true })
  message?: string;

  @Column({ nullable: true })
  branchInstruction?: string;

  @Column({
    enum: SessionEventDetectionType,
    default: SessionEventDetectionType.SENTENCE_SIMILARITY,
  })
  detectionType!: SessionEventDetectionType;

  @Column({
    enum: SessionEventVisibilityType,
    default: SessionEventVisibilityType.ACTIVE,
  })
  visibilityType!: SessionEventVisibilityType;

  @DeleteDateColumn()
  deletedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  detectionData?: Record<string, any>;
}
