import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { CourseCopilotEventType } from '../enum/course-copilot.enum';

/**
 * Append-only build progress log. Pushed over the `/course-copilot` socket and
 * paged by `afterSeq` from `GET sessions/:id`, so a client that missed a push —
 * a dropped socket, a different ECS task — closes the gap on its next poll.
 *
 * `seq` comes from `course_copilot_sessions.lastEventSeq`; payloads are capped
 * at 8 KB and marked when truncated.
 */
@Entity('course_copilot_events')
@Index('idx_course_copilot_events_session_seq', ['sessionId', 'seq'], {
  unique: true,
})
export class CourseCopilotEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'int' })
  seq!: number;

  @Column({ type: 'varchar', length: 24, enum: CourseCopilotEventType })
  type!: CourseCopilotEventType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, any>;
}
