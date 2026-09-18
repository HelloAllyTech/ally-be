import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  BuilderLessonCategory,
  BuilderLessonStatus,
} from '../enum/builder.enum';

/**
 * Cross-session memory. A finished build writes a short retrospective; those
 * bullets land here and are fed back into later interview and build prompts.
 *
 * The point is compounding: without this, every build rediscovers the same
 * traps (a migration numbering collision, a suite that needs NX_DAEMON=false)
 * and pays for the discovery again in tokens and wall-clock.
 *
 * A **curated set**, not an append-only log. Raw retrospective bullets land as
 * `candidate`; a consolidation pass merges duplicates into one row with a
 * `sourceCount`, rewrites imprecise ones, and retires what has gone stale or
 * been contradicted — because the context budget a prompt can spend on lessons
 * is fixed, and five rows saying the same thing crowd out four that don't.
 * `timesApplied` / `timesContradicted` are what make that judgement evidence
 * rather than taste.
 */
@Entity('builder_lessons')
@Index('idx_builder_lessons_repo', ['repo'])
@Index('idx_builder_lessons_status', ['status'])
export class BuilderLesson extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Session that learned it, for provenance. Kept even if that session is gone. */
  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  /**
   * NULL when the lesson is platform-wide rather than about one repo.
   * @deprecated Read `repos` instead — kept so rows written before the
   * multi-repo fix still resolve. A lesson from a two-repo build used to lose
   * its attribution entirely and become platform-wide.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  repo?: string | null;

  /** Repos this applies to. NULL/empty means platform-wide. */
  @Column({ type: 'jsonb', nullable: true })
  repos?: string[] | null;

  @Column({ enum: BuilderLessonCategory })
  category!: BuilderLessonCategory;

  @Column({ type: 'text' })
  lesson!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: BuilderLessonStatus.CANDIDATE,
  })
  status!: BuilderLessonStatus;

  /**
   * Pinned by a person. The curator may never edit or retire one: a human who
   * has decided a lesson matters outranks a model's tidying pass.
   */
  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  /**
   * How many separate builds independently produced this lesson — the ExpeL
   * AGREE weight. Five builds hitting the same trap is a much stronger signal
   * than one, and the flat table threw that information away by storing five
   * near-identical rows instead of one with a count.
   */
  @Column({ type: 'int', default: 1 })
  sourceCount!: number;

  /** Sessions that contributed, surviving merges. */
  @Column({ type: 'jsonb', nullable: true })
  sourceSessionIds?: string[] | null;

  /**
   * Times a run cited this lesson as having changed what it did. An unused
   * lesson is one nobody should keep paying context for.
   */
  @Column({ type: 'int', default: 0 })
  timesApplied!: number;

  /** Times a run hit the problem this lesson warns about anyway. */
  @Column({ type: 'int', default: 0 })
  timesContradicted!: number;

  /** Where this went when it was merged into another lesson. */
  @Column({ type: 'uuid', nullable: true })
  mergedIntoId?: string | null;

  /** Free-form topical tags the curator assigns, for scoping and the UI. */
  @Column({ type: 'jsonb', nullable: true })
  tags?: string[] | null;

  @Column({ type: 'timestamp', nullable: true })
  lastAppliedAt?: Date | null;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
