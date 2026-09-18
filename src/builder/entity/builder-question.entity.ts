import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderQuestionStatus } from '../enum/builder.enum';

/**
 * A question the agent paused a build to ask.
 *
 * `groupId` is what makes one pause carry several questions. The agent is
 * told to batch everything ambiguous into a single pause rather than
 * stopping four times: each stop costs a runner teardown, a fresh dispatch
 * and a wait on a human, so four separate pauses is the difference between a
 * build finishing this morning and finishing tomorrow. The resume run is not
 * dispatched until every question in the group is answered.
 */
@Entity('builder_questions')
@Index('idx_builder_questions_session', ['sessionId', 'status'])
@Index('idx_builder_questions_group', ['groupId'])
export class BuilderQuestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'uuid' })
  runId!: string;

  /** Shared by every question asked in the same pause. */
  @Column({ type: 'uuid' })
  groupId!: string;

  /** Order within the group, so the UI asks them the way the agent meant to. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /** BuilderQuestionEvent shape — the same widget the interview uses. */
  @Column({ type: 'jsonb' })
  question!: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  answer?: Record<string, any> | null;

  /** Human-readable answer text, for the resume prompt and the transcript. */
  @Column({ type: 'text', nullable: true })
  answerText?: string | null;

  @Column({
    type: 'varchar',
    length: 12,
    enum: BuilderQuestionStatus,
    default: BuilderQuestionStatus.PENDING,
  })
  status!: BuilderQuestionStatus;

  @Column({ type: 'timestamp', nullable: true })
  answeredAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  answeredBy?: number | null;
}
