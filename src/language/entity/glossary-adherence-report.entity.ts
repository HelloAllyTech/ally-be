import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** One avoid-term's hits within a session's agent utterances. */
export interface GlossaryAdherenceViolation {
  /** The avoid-listed term that was found in agent speech. */
  term: string;
  /** Section whose avoid-list the term came from. */
  sectionCode: string;
  /** Occurrences across all agent messages in the session. */
  count: number;
  /** Up to a few message snippets showing the term in context. */
  examples: string[];
}

/**
 * Per-session glossary adherence: deterministic avoid-list violation counts
 * scanned from the agent's transcript (no LLM, no hand labels — the glossary's
 * own `say X (avoid: Y)` pairs are the lexicon). `glossaryVersions` mirrors
 * the start_metrics provenance so adherence trends group by the exact
 * glossary a session ran with. Derived data — rebuilt on re-scan (upsert by
 * session). No tenant column: analytics surface is super-admin, mirroring
 * roleplay-session-logs.
 */
@Entity('glossary_adherence_reports')
@Index('uq_glossary_adherence_reports_session', ['scenarioSessionId'], {
  unique: true,
})
@Index('idx_glossary_adherence_reports_language', ['languageId', 'createdAt'])
export class GlossaryAdherenceReport extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  languageId!: number;

  /** sectionCode -> version the scan attributed this session to. */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  glossaryVersions!: Record<string, number>;

  @Column({ type: 'int', default: 0 })
  agentMessageCount!: number;

  @Column({ type: 'int', default: 0 })
  totalViolations!: number;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  violations!: GlossaryAdherenceViolation[];
}
