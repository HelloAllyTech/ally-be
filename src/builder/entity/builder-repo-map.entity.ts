import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A Repo Knowledge Pack: a condensed, few-thousand-token map of one repo
 * (module inventory, conventions, notable recent changes), refreshed by the
 * builder-context-refresh workflow rather than derived per session.
 *
 * This exists to make the interviewer codebase-aware cheaply. Reading real
 * files through the GitHub tools costs a round-trip and thousands of tokens
 * each; the map is the index that tells the agent which few files are worth
 * that cost. One row per repo — a refresh overwrites in place, and
 * `commitSha` + `generatedAt` let the UI say how stale the answer might be.
 */
@Entity('builder_repo_maps')
export class BuilderRepoMap extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_builder_repo_maps_repo', { unique: true })
  @Column({ type: 'varchar', length: 80 })
  repo!: string;

  /** HEAD the map was generated from. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  commitSha?: string | null;

  @Column({ type: 'text' })
  mapMd!: string;

  /** File/module counts, approximate token size — shown in the settings view. */
  @Column({ type: 'jsonb', nullable: true })
  stats?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  generatedAt?: Date | null;
}
