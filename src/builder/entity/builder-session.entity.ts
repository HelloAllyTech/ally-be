import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderSessionStatus, BuilderStage } from '../enum/builder.enum';

/**
 * One Builder session: a PRD interview that (once the PRD is ready) becomes
 * one or more build runs.
 *
 * `lastMessageSeq` is the monotonic transcript counter — appends increment it
 * atomically (UPDATE … RETURNING) so builder_messages.seq stays gapless and
 * unique per session under concurrent writers (same primitive as
 * character_interview_sessions).
 *
 * `currentStage` is denormalized from the newest `stage_change` build event
 * so the session list can show "what is it doing right now" without joining
 * the event log on every row.
 */
@Entity('builder_sessions')
@Index('idx_builder_sessions_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_builder_sessions_status', ['status'], {
  where: '"deletedAt" IS NULL',
})
export class BuilderSession extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, default: 'New build' })
  title!: string;

  /**
   * Kebab-case, unique across sessions: the base of every branch this session
   * pushes (`builder/<slug>`). Unique because two sessions sharing a branch
   * name would clobber each other's work in the same repo.
   */
  @Index('idx_builder_sessions_slug', { unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({
    enum: BuilderSessionStatus,
    default: BuilderSessionStatus.INTERVIEWING,
  })
  status!: BuilderSessionStatus;

  // `type` is explicit because the nullable union reflects as Object, which
  // TypeORM cannot map to a Postgres type. The column is a varchar with a
  // CHECK, exactly like `status` above.
  @Column({ type: 'varchar', length: 16, enum: BuilderStage, nullable: true })
  currentStage?: BuilderStage | null;

  /** Repos this build will touch — agent-proposed, admin-confirmed. */
  @Column({ type: 'jsonb', nullable: true })
  repos?: string[] | null;

  /**
   * Coding engine + model for build runs. Parameters rather than constants so
   * a non-Anthropic CLI can be slotted in without a schema change.
   */
  @Column({ type: 'varchar', length: 40, default: 'claude-code' })
  engine!: string;

  @Column({ type: 'varchar', length: 80, nullable: true })
  model?: string | null;

  @Column({ type: 'int', default: 0 })
  lastMessageSeq!: number;

  /**
   * Exemplar ids chosen for this session's context, frozen at first use.
   *
   * Frozen because the context block lives inside the prompt-cached prefix: a
   * selection that changed between turns would invalidate the cache on every
   * turn, which costs far more than the exemplars are worth. Re-picked only
   * when the repo set changes, since that is what makes a different past build
   * relevant.
   */
  @Column({ type: 'jsonb', nullable: true })
  contextExemplarIds?: string[] | null;

  /** Repos in play when the exemplars above were chosen. */
  @Column({ type: 'jsonb', nullable: true })
  contextExemplarRepos?: string[] | null;

  /**
   * Monotonic run counter, incremented the same atomic way as
   * `lastMessageSeq`. Two dispatches for one session used to read the same
   * `MAX(sequence)` and collide — a double-clicked answer was enough.
   */
  @Column({ type: 'int', default: 0 })
  lastRunSequence!: number;

  /**
   * Spend ceiling for the whole session. ally-be refuses to dispatch another
   * run once totalCostUsd reaches it — an agent that loops is otherwise
   * bounded only by patience.
   */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  budgetUsd?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, default: 0 })
  totalCostUsd!: string;

  /** Billed GitHub Actions minutes across this session's runs. */
  @Column({ type: 'int', default: 0 })
  runnerMinutes!: number;

  @Column({ type: 'text', nullable: true })
  error?: string | null;

  /**
   * Owning tenant, or NULL when a platform admin ran the session. Carried for
   * cost attribution; a session is private to its creator either way.
   */
  @Index('idx_builder_sessions_tenant_id')
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  @DeleteDateColumn()
  deletedAt?: Date;
}
