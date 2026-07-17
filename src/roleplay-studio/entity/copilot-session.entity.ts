import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CopilotSessionStatus } from '../enum/copilot-session-status.enum';

/**
 * One copilot conversation over a spec. `lastMessageSeq` is the monotonic
 * message counter: appends increment it atomically (UPDATE … RETURNING) so
 * copilot_messages.seq is gapless and unique per session even under
 * concurrent writers.
 */
@Entity('copilot_sessions')
@Index('idx_copilot_sessions_spec_id', ['specId'], {
  where: '"deletedAt" IS NULL',
})
export class CopilotSession extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  specId!: string;

  @Column({ enum: CopilotSessionStatus, default: CopilotSessionStatus.ACTIVE })
  status!: CopilotSessionStatus;

  @Column({ type: 'int', default: 0 })
  lastMessageSeq!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
