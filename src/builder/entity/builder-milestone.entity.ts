import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderMilestoneStatus } from '../enum/builder.enum';

/**
 * One shippable slice of a large PRD.
 *
 * Epic mode exists because a PRD big enough to be worth Builder's time is
 * often too big for one run: a two-hour ceiling, a context window, and a pull
 * request nobody wants to review in one sitting. Milestones cut it into pieces
 * that each land as their own reviewable PR.
 *
 * Rows on the session rather than child sessions, deliberately. A child session
 * would duplicate the interview, the PRD and the readiness rubric, and — worse
 * — every session owns a unique `slug` that names the branches it pushes, so
 * five child sessions would mean five unrelated branch families for one
 * feature. Here the slug stays one family: `builder/<slug>-m1`, `-m2`, …
 *
 * `requirementIds` is how a milestone knows its share of the work. The
 * decomposition is validated to assign every requirement exactly once, because
 * a requirement in two milestones gets built twice and one in none is silently
 * dropped — and "silently dropped" is the failure nobody notices until the
 * feature is short a piece.
 */
@Entity('builder_milestones')
@Index('idx_builder_milestones_session', ['sessionId'])
@Index('idx_builder_milestones_position', ['sessionId', 'position'], {
  unique: true,
})
export class BuilderMilestone extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  /** 1-based build order. Milestones are strictly sequential. */
  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  summaryMd?: string | null;

  /** Which PRD requirements this milestone owns. */
  @Column({ type: 'jsonb', nullable: true })
  requirementIds?: string[] | null;

  /** Anything the decomposition wants the coder to know for this slice. */
  @Column({ type: 'text', nullable: true })
  technicalNotesMd?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: BuilderMilestoneStatus.PENDING,
  })
  status!: BuilderMilestoneStatus;

  /**
   * Branch base for this milestone: `<session slug>-m<position>`.
   *
   * Each milestone branches from the previous one rather than from master, so
   * milestone 2 can build on milestone 1's code before anyone has merged it.
   * GitHub retargets a stacked PR automatically when its base merges.
   */
  @Column({ type: 'varchar', length: 100 })
  branchSlug!: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  error?: string | null;
}
