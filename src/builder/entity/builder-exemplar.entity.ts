import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  BuilderExemplarOutcome,
  BuilderFailureTag,
} from '../enum/builder.enum';

/**
 * One finished build, archived as an example a later build can learn from:
 * what was asked, what was done, and — crucially — how it went afterwards.
 *
 * The gap this fills is that Builder had no memory of *outcomes*. Lessons
 * captured what an agent thought it had learned in the minutes after finishing,
 * which is the worst moment to judge whether the work was any good. Whether a
 * pull request merged, was closed unmerged, needed three fix runs or collected
 * eleven review comments is only knowable later, and it is the part that says
 * which approaches are working.
 *
 * Failures are archived too. "A similar build tried this and the PR was closed
 * unmerged because X" is more useful to the next attempt than any number of
 * successes, and only keeping the wins would make the corpus flattering and
 * useless.
 *
 * `summaryMd` is what actually goes into a prompt — a short digest rather than
 * the whole PRD, because the point is to spend a few hundred tokens on "here is
 * how this went last time", not to re-read a document.
 */
@Entity('builder_exemplars')
@Index('idx_builder_exemplars_session', ['sessionId'], { unique: true })
@Index('idx_builder_exemplars_outcome', ['outcome'])
export class BuilderExemplar extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'jsonb', nullable: true })
  repos?: string[] | null;

  /** The PRD as it stood when the build ran. */
  @Column({ type: 'jsonb', nullable: true })
  prdSnapshot?: Record<string, any> | null;

  /** The plan the planner pass wrote, if there was one. */
  @Column({ type: 'text', nullable: true })
  planMd?: string | null;

  /** Files changed / insertions / deletions per repo. */
  @Column({ type: 'jsonb', nullable: true })
  diffstat?: Record<string, any> | null;

  @Column({
    type: 'varchar',
    length: 24,
    default: BuilderExemplarOutcome.OPEN,
  })
  outcome!: BuilderExemplarOutcome;

  /**
   * How much human and machine correction the work needed after it was
   * "finished". These are the honest quality signals — a build that merged
   * after four fix runs and eleven comments is not the same as one that
   * merged clean, and only these columns can tell them apart.
   */
  @Column({ type: 'int', default: 0 })
  fixRunCount!: number;

  @Column({ type: 'int', default: 0 })
  reviewCommentCount!: number;

  @Column({ type: 'int', default: 0 })
  ciFailureCount!: number;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  costUsd?: string | null;

  @Column({ type: 'int', nullable: true })
  runnerMinutes?: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  timeToMergeHours?: string | null;

  /** Categorised reasons this needed rework, from BuilderFailureTag. */
  @Column({ type: 'jsonb', nullable: true })
  failureTags?: BuilderFailureTag[] | null;

  /** ~150 words: what was asked, what was done, what happened after. */
  @Column({ type: 'text', nullable: true })
  summaryMd?: string | null;

  /** Last time the outcome pipeline refreshed this row. */
  @Column({ type: 'timestamp', nullable: true })
  lastOutcomeSyncAt?: Date | null;
}
