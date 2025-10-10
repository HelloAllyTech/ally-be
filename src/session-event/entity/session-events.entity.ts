import { Column, Entity, PrimaryColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from '../../common/entities/base-without-tenant.entity';
import { SessionEventVisibilityType } from '../enum/session-event-visibility-type.enum';
import { SessionEventDetectionType } from '../enum/session-event-detection-type.enum';

@Entity('session_events')
export class SessionEvents extends BaseWithoutTenantEntity {
  @PrimaryColumn({ type: 'varchar' })
  id!: string;

  @Column()
  name!: string;

  @Column()
  description!: string;

  @Column()
  score!: number;

  @Column()
  emoji!: string;

  @Column()
  message!: string;

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

  @Column('text', { array: true, nullable: true })
  sentences?: string[];
}
