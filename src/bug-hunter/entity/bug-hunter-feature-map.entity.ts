import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Where the value a card is about actually comes from. Required since
 * 2026-10-13: the first map run wrote a "Simulation Translations" card in
 * ally-web that described UI label bundles, while simulation titles come
 * translated from ally-be's database — the exact confusion behind a wrong
 * frontend fix that week. Naming the source makes that impossible to blur.
 */
export const FEATURE_VALUE_SOURCES = [
  /** Rows in a table, served by an API (content an admin or a job writes). */
  'database',
  /** i18n locale files and published translation bundles: labels that exist only in code. */
  'locale_file',
  /** Environment, feature flags, a config file, an org preference. */
  'config',
  /** A constant or a value computed in code. */
  'code',
  /** A third-party service (speech, LLM, analytics). */
  'external',
] as const;
export type FeatureValueSource = (typeof FEATURE_VALUE_SOURCES)[number];

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
 * One row per feature (slug), owned by the repo that stores its value. A map
 * run upserts the cards whose entry points changed since `sourceSha` and
 * adds its own part to cards another repo owns. Cards hold file paths,
 * routes and table names only — never data from those tables.
 */
@Entity('bug_hunter_feature_maps')
@Index('uq_bug_hunter_feature_maps_slug', ['slug'], { unique: true })
export class BugHunterFeatureMap extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The repo that OWNS the feature's value — where it is stored or decided.
   * One card per feature across repos: a run in another repo adds its part
   * (entry points, endpoints, its line in `relatedRepos`) to this card rather
   * than writing a second one.
   */
  @Column({ type: 'varchar', length: 40 })
  repo!: string;

  /** Stable kebab-case key, unique across repos, e.g. "simulation-titles-translated". */
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** How the feature works, from where the value is stored to where it is shown. Under 2,000 characters. */
  @Column({ type: 'text' })
  summary!: string;

  @Column({ name: 'value_source', type: 'varchar', length: 20 })
  valueSource!: FeatureValueSource;

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
