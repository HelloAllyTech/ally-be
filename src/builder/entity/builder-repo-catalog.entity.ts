import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/** One thing in a repo a feature could reuse, as `extract-catalog.mjs` found it. */
export interface BuilderCatalogEntry {
  /** module | table | route | scheduled_job | app | screen_route | page | component | screen | endpoint | doc */
  kind: string;
  name: string;
  /** Repo-relative path of the file or directory it was found in. */
  path: string;
  detail?: string;
  /** For web and mobile components: which app it belongs to. */
  app?: string;
}

/**
 * A repo's capability catalog: what is in it, listed by a script rather than
 * described by a model.
 *
 * It sits beside `builder_repo_maps` rather than in it because the two fail
 * differently and must be refreshed independently. A knowledge pack is model
 * prose and can come back as one sentence; a catalog is read off the tree and
 * comes back the size of the repo or not at all. Keeping them in one row would
 * let a failed pack and a good catalog — or the reverse — overwrite each other.
 *
 * One row per repo, replaced whole by the context-refresh workflow.
 */
@Entity('builder_repo_catalogs')
export class BuilderRepoCatalog extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_builder_repo_catalogs_repo', { unique: true })
  @Column({ type: 'varchar', length: 80 })
  repo!: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  commitSha?: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  entries!: BuilderCatalogEntry[];

  /** Tracked-file count and entries per kind. */
  @Column({ type: 'jsonb', nullable: true })
  stats?: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  generatedAt?: Date | null;
}
