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

/** Lifecycle of a consolidation proposal in `entries`. Proposals are invisible
 * to the compiler; `accepted` means the markdown was appended to `content`
 * (the row is kept for annotation provenance / the consumed-set). */
export enum GlossaryEntryStatus {
  PROPOSED = 'proposed',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

/**
 * One consolidation proposal: a markdown line (or few lines) the judge-mining
 * job suggests appending to the section's `content`. The glossary body itself
 * is plain markdown (`content`) — proposals are the only structured part,
 * because accept/reject review needs discrete items with provenance.
 */
export interface GlossaryEntry {
  id: string;
  /** Proposed markdown to append to the section content on accept. */
  markdown: string;
  status: GlossaryEntryStatus;
  importance?: number;
  provenance?: {
    source: 'consolidation' | 'seed' | 'manual';
    annotationIds?: string[];
    /** Distinct tenants whose annotations support this proposal — the breadth
     * signal for a future global-vs-overlay split (multi-tenant support ⇒
     * global candidate; single-tenant ⇒ overlay candidate). */
    tenantIds?: string[];
  };
}

/**
 * A section of a per-language glossary served to the live agent — a compact
 * "constrain and correct" reference for languages the LLM half-knows
 * (LANGUAGE_GLOSSARY_DESIGN.md). The section body is plain markdown
 * (`content`) — what admins edit is what the agent gets (prefixed with the
 * title header). `entries` holds only consolidation proposals awaiting
 * review.
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

  /** The glossary body: plain markdown, served to the agent as-is. */
  @Column({ type: 'text', default: '' })
  content!: string;

  /** Consolidation proposals awaiting review — never served to the agent. */
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
