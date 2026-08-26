import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BuilderLessonCategory } from '../enum/builder.enum';

/**
 * Cross-session memory. A finished build writes a short retrospective; those
 * bullets land here and are fed back into later interview and build prompts.
 *
 * The point is compounding: without this, every build rediscovers the same
 * traps (a migration numbering collision, a suite that needs NX_DAEMON=false)
 * and pays for the discovery again in tokens and wall-clock.
 */
@Entity('builder_lessons')
@Index('idx_builder_lessons_repo', ['repo'])
export class BuilderLesson extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Session that learned it, for provenance. Kept even if that session is gone. */
  @Column({ type: 'uuid', nullable: true })
  sessionId?: string | null;

  /** NULL when the lesson is platform-wide rather than about one repo. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  repo?: string | null;

  @Column({ enum: BuilderLessonCategory })
  category!: BuilderLessonCategory;

  @Column({ type: 'text' })
  lesson!: string;

  @Column({ type: 'int', nullable: true })
  createdBy?: number;
}
