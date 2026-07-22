import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Tiering switch (LANGUAGE_GLOSSARY_DESIGN.md §5). */
export enum GlossaryInjectionMode {
  /** Compiled into the Tier 0 style card injected every turn (token-capped). */
  ALWAYS = 'always',
  /** Joins knowledge-retrieval title selection; `retrievalHint` describes when. */
  RETRIEVED = 'retrieved',
}

/** Section lifecycle. Runtime serves `published` sections only. */
export enum GlossarySectionStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/** Per-entry lifecycle inside `entries` — consolidation proposals land as
 * `proposed` and are invisible to the compiler until a reviewer accepts them. */
export enum GlossaryEntryStatus {
  PUBLISHED = 'published',
  PROPOSED = 'proposed',
  REJECTED = 'rejected',
}

export type GlossaryEntryType = 'term_pair' | 'rule' | 'pattern';

/**
 * One typed glossary entry. Shape varies by `type`:
 * - `term_pair` (register fix): `english` / `preferred` / `avoid`
 * - `rule` (agreement fix): `text` + native-script `examples`
 * - `pattern` (phrasebook): `text` (+ optional `examples`)
 */
export interface GlossaryEntry {
  id: string;
  type: GlossaryEntryType;
  english?: string;
  preferred?: string;
  avoid?: string;
  text?: string;
  note?: string;
  examples?: string[];
  status: GlossaryEntryStatus;
  importance?: number;
  provenance?: {
    source: 'seed' | 'consolidation' | 'manual';
    annotationIds?: string[];
  };
}

/**
 * A section of a per-language glossary served to the live agent — a compact
 * "constrain and correct" reference for languages the LLM half-knows
 * (LANGUAGE_GLOSSARY_DESIGN.md). The prompt block is compiled from published
 * entries; the jsonb is the source of truth, never hand-formatted text.
 *
 * `organizationId` is NULL for global rows (all rows in v1). Uniqueness over
 * (languageId, sectionCode, organizationId) is enforced by an expression index
 * in the migration (COALESCE sentinel for NULL org), which TypeORM cannot
 * express — do not add a plain unique index here.
 */
@Entity('language_glossary_sections')
@Index('idx_language_glossary_language_status_mode', [
  'languageId',
  'status',
  'injectionMode',
])
export class LanguageGlossarySection extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  languageId!: number;

  @Column({ type: 'uuid', nullable: true })
  organizationId?: string;

  @Column({ type: 'varchar', length: 100 })
  sectionCode!: string;

  /** Shown to the retrieval selector (Tier 1) and in the admin UI. */
  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  entries!: GlossaryEntry[];

  /** Tier 1 only — one line of "when to pull this" trigger conditions. */
  @Column({ type: 'text', nullable: true })
  retrievalHint?: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: GlossaryInjectionMode.RETRIEVED,
  })
  injectionMode!: GlossaryInjectionMode;

  @Column({ type: 'varchar', length: 20, default: GlossarySectionStatus.DRAFT })
  status!: GlossarySectionStatus;

  /** Consolidation-assigned score; drives Tier 0 slot allocation + eviction. */
  @Column({ type: 'int', nullable: true })
  importance?: number;

  @Column({ type: 'jsonb', nullable: true })
  provenance?: Record<string, unknown>;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  createdBy?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  updatedBy?: string;
}
