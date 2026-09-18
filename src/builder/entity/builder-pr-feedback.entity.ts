import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
} from '../enum/builder.enum';

/**
 * Something that happened to one of Builder's pull requests after it opened:
 * a failing CI run, an inline review comment, a review verdict.
 *
 * A table of its own rather than reusing `builder_questions`, which is the
 * nearest-looking thing. A question is an admin-facing pause artifact: the run
 * is stopped, the person is expected to answer, and the answer resumes it.
 * Feedback is the opposite shape — it arrives while nothing is running, from
 * someone who is not the session's owner, and it is *Builder* that has to act.
 * Sharing the table would have meant a status enum where half the values were
 * meaningless for either half.
 *
 * `(pullRequestId, kind, externalId)` is unique because this is polled: every
 * reconcile tick re-reads the whole PR and sees every comment again, so the
 * write has to be an upsert or the row count would grow with the clock.
 */
@Entity('builder_pr_feedback')
@Index('idx_builder_pr_feedback_pr', ['pullRequestId'])
@Index('idx_builder_pr_feedback_status', ['status'])
@Index(
  'idx_builder_pr_feedback_external',
  ['pullRequestId', 'kind', 'externalId'],
  { unique: true },
)
export class BuilderPrFeedback extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  pullRequestId!: string;

  /** Denormalised so a session's whole feedback set is one query. */
  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BuilderPrFeedbackKind;

  /**
   * GitHub's id for a comment or review; for CI, the head sha plus the check
   * name. Whatever makes "the same problem" the same row on the next poll.
   */
  @Column({ type: 'varchar', length: 200 })
  externalId!: string;

  /** GitHub login. Builder's own bot comments are skipped, not stored. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  author?: string | null;

  @Column({ type: 'text', nullable: true })
  body?: string | null;

  @Column({ type: 'text', nullable: true })
  path?: string | null;

  @Column({ type: 'int', nullable: true })
  line?: number | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: BuilderPrFeedbackStatus.PENDING,
  })
  status!: BuilderPrFeedbackStatus;

  /** The fix run that took this on, once one has. */
  @Column({ type: 'uuid', nullable: true })
  fixRunId?: string | null;

  /** Where Builder answered, so a reader can follow the conversation. */
  @Column({ type: 'text', nullable: true })
  replyUrl?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  addressedAt?: Date | null;
}
