import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import type { JournalLabel } from '../util/journal-parser.util';
import { ProductUpdate } from './product-update.entity';

/**
 * Where a merge is in the pipeline.
 *
 *  - `pending` — read from the journal; its details are not yet fetched from GitHub.
 *  - `enriched` — details fetched (or given up on after repeated failures,
 *    in which case the journal's own text is all the model sees); waiting to
 *    be consolidated.
 *  - `consolidated` — belongs to a product update.
 *  - `noise` — changes nothing for anyone (tests, docs, lint, version bumps).
 */
export enum ProductUpdateSourceStatus {
  PENDING = 'pending',
  ENRICHED = 'enriched',
  CONSOLIDATED = 'consolidated',
  NOISE = 'noise',
}

/**
 * One merge to a release branch, taken from `ally-changelog`'s journal — the
 * input product updates are built from.
 *
 * Keyed on the journal's own stable id, so reading the journal again (every
 * run, or a full backfill) is idempotent: an entry becomes exactly one row,
 * once.
 */
@Entity('product_update_sources')
@Index('idx_product_update_sources_status', ['status', 'mergedAt'])
@Index('idx_product_update_sources_update_id', ['updateId'])
export class ProductUpdateSource extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_product_update_sources_journal_id', { unique: true })
  @Column({ name: 'journal_id', type: 'varchar', length: 64 })
  journalId!: string;

  @Column({ name: 'update_id', type: 'uuid', nullable: true })
  updateId!: string | null;

  @ManyToOne(() => ProductUpdate, (update) => update.sources, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'update_id' })
  update?: ProductUpdate | null;

  @Column({
    type: 'varchar',
    length: 16,
    enum: ProductUpdateSourceStatus,
    default: ProductUpdateSourceStatus.PENDING,
  })
  status!: ProductUpdateSourceStatus;

  @Column({ type: 'varchar', length: 64 })
  repo!: string;

  /** ally-web only: the apps the journal said the push touched. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  apps!: string[];

  @Column({ name: 'merged_at', type: 'timestamp' })
  mergedAt!: Date;

  /** The per-merge drafter's label — its guess, kept as context. */
  @Column({ name: 'journal_label', type: 'varchar', length: 24 })
  journalLabel!: JournalLabel;

  @Column({ name: 'pr_number', type: 'int', nullable: true })
  prNumber!: number | null;

  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl!: string | null;

  @Column({ name: 'head_ref', type: 'varchar', length: 255, nullable: true })
  headRef!: string | null;

  /**
   * The commit whose release makes this live: a PR's merge commit, or a
   * push's head. Kept for tracing; liveness itself is decided by time (see
   * `liveness.util.ts`).
   */
  @Column({ name: 'head_sha', type: 'varchar', length: 40, nullable: true })
  headSha!: string | null;

  /** For a direct push, the `before` of its compare range. */
  @Column({ name: 'base_sha', type: 'varchar', length: 48, nullable: true })
  baseSha!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  author!: string | null;

  /** A PR's title, or every commit subject of a direct push. */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  subjects!: string[];

  /** A PR's description, or a push's commit bodies. Capped; see the ingest service. */
  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  files!: string[];

  /** The file list is incomplete — GitHub caps it, or enrichment gave up. */
  @Column({ name: 'files_truncated', type: 'boolean', default: false })
  filesTruncated!: boolean;

  /** Release targets that must ship this change (`ally-be`, `ally-web:admin`, `ally-mobile`, …). */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  deployables!: string[];

  /** False for a change that is only tests or docs: it ships nothing, so it holds nothing back. */
  @Column({ name: 'gates_liveness', type: 'boolean', default: true })
  gatesLiveness!: boolean;

  @Column({ name: 'live_at', type: 'timestamp', nullable: true })
  liveAt!: Date | null;

  @Column({ name: 'enrich_attempts', type: 'int', default: 0 })
  enrichAttempts!: number;

  @Column({ name: 'consolidate_attempts', type: 'int', default: 0 })
  consolidateAttempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'enriched_at', type: 'timestamp', nullable: true })
  enrichedAt!: Date | null;

  @Column({ name: 'consolidated_at', type: 'timestamp', nullable: true })
  consolidatedAt!: Date | null;
}
