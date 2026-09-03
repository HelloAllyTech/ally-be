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
  /**
   * Unattended-adjudication state, so an irreversible verdict is not decided
   * by one sample of a stochastic judge.
   *
   * Rejecting consumes a proposal's annotations by design, so nothing
   * re-derives the rule — a reject is permanent. The adjudicator is not
   * consistent enough to be trusted with that on one reading: on 2026-09-02
   * the same Tamil proposal was ACCEPTED at 15:00 and REJECTED at 16:00 on
   * identical input, and both verdicts were individually defensible (its own
   * example line appears verbatim in an existing rule, but it also adds a
   * novel "avoid non-standard forms" clause). A borderline call decided a
   * permanent outcome by chance.
   *
   * So rejects need the same verdict on CONSECUTIVE passes: a clear-cut
   * reject repeats, a coin-flip does not. Accepts apply on the first pass —
   * they are reversible through the batch record.
   */
  adjudication?: {
    /** Consecutive passes that voted to reject. Reset by any other verdict. */
    rejectVotes: number;
    lastRejectReason?: string;
    lastRejectAt?: string;
    /**
     * Consecutive deferrals for the SAME reason — drives the re-adjudication
     * backoff. A deferral leaves the entry `PROPOSED`, so without this the
     * hourly pass re-bills an unchangeable verdict forever
     * (see GLOSSARY_DEFER_BACKOFF_MAX_HOURS). Reset when the reason changes.
     */
    deferrals?: number;
    lastDeferredAt?: string;
    lastDeferReason?: string;
  };
  provenance?: {
    source: 'consolidation' | 'seed' | 'manual';
    annotationIds?: string[];
    /** Distinct tenants whose annotations support this proposal — the breadth
     * signal the global-vs-overlay routing reads (multi-profile support ⇒
     * global; single-profile ⇒ that profile's overlay). */
    tenantIds?: string[];
    /** The consolidation run that created this entry — the rollback handle. */
    batchId?: string;
    /** Distributional evidence for lexicon entries (construct-class.util):
     * say/avoid corpus counts + verdict. 'contradicted' blocks auto-accept. */
    evidence?: {
      say: string | null;
      avoid: string | null;
      sayLearnerCount: number;
      avoidAgentCount: number;
      avoidLearnerCount: number;
      verdict: 'confirmed' | 'unverified' | 'contradicted';
    };
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

  /** NULL = global row. Non-NULL scopes this section to a variety profile
   * (language_variety_profiles): runtime serves global + the session
   * profile's overlays, overlay winning on sectionCode. */
  @Column({ type: 'uuid', nullable: true })
  profileId?: string | null;

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

  /** Admin override: the computed tier pass never changes a pinned section's
   * injectionMode. Set automatically when an admin changes the mode by hand. */
  @Column({ type: 'boolean', default: false })
  tierPinned!: boolean;

  /** ⚠️ WRITE-ONLY since the tiering knapsack landed. Consolidation still sets
   * it, nothing reads it: Tier 0 admission and eviction come from
   * `computeTierAssignment` (score/token density under the cap), not from this
   * column. Kept because it is cheap and a per-rule score may yet want a home;
   * do not reintroduce it as a placement input without reading that util. */
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
