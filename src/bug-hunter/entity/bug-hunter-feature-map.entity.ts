import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * One feature card: how a user-facing feature works, written by the weekly
 * feature-map run (BugHuntTrigger.FEATURE_MAP) and read by every study.
 *
 * Why it exists: on 2026-10-12 a fix session "fixed" untranslated simulation
 * titles in the helpline frontend while the stored translations were never
 * generated in ally-be. The session had one repo and a cold start, so it
 * guessed at the architecture. A card says, before anyone opens a file,
 * where the feature's value is stored, who writes it, which endpoint carries
 * it and which screen shows it — across repos.
 *
 * One row per (repo, slug). A map run upserts the cards whose entry points
 * changed since `sourceSha` and leaves the rest. Cards hold file paths,
 * routes and table names only — never data from those tables.
 */
@Entity('bug_hunter_feature_maps')
@Index('uq_bug_hunter_feature_maps_repo_slug', ['repo', 'slug'], {
  unique: true,
})
export class BugHunterFeatureMap extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The repo the run mapped from; a card may still name other repos in `relatedRepos`. */
  @Column({ type: 'varchar', length: 40 })
  repo!: string;

  /** Stable kebab-case key, e.g. "simulation-translations". */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** How the feature works, from where the value is stored to where it is shown. Under 2,000 characters. */
  @Column({ type: 'text' })
  summary!: string;

  /** Files, routes and components where the feature starts or shows. */
  @Column({ name: 'entry_points', type: 'jsonb', default: () => `'[]'` })
  entryPoints!: string[];

  /** HTTP routes the feature uses, "GET /v2/learn/scenarios" style. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  endpoints!: string[];

  /** Tables, columns, locale files or config the feature's values live in. */
  @Column({ name: 'data_homes', type: 'jsonb', default: () => `'[]'` })
  dataHomes!: string[];

  /** Who or what writes those values: an admin screen, a job, a migration, a sync script. */
  @Column({ name: 'written_by', type: 'text', nullable: true })
  writtenBy?: string | null;

  /** Other Ally repos that take part, and how, e.g. "ally-web: renders the list". */
  @Column({ name: 'related_repos', type: 'jsonb', default: () => `'[]'` })
  relatedRepos!: string[];

  /** Traps a newcomer would fall into on this feature. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  gotchas!: string[];

  /** The commit the card describes; the next map run diffs from here. */
  @Column({ name: 'source_sha', type: 'varchar', length: 64, nullable: true })
  sourceSha?: string | null;

  /** The map run that last wrote this card. */
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;
}
