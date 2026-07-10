import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per language error per judge run — the language-quality judge's
 * categorized error annotations (see language-eval-judge-schema.md). A turn can
 * carry several annotations; a clean session has NONE (its denominator lives in
 * language_judgment_sessions, which every judged session gets).
 *
 * NO scalar quality scores anywhere — errors carry dimension/category/severity
 * and the weighted error rate per 100 turns is computed at read time from
 * these rows + the session-row denominators.
 *
 * Idempotency: re-judging a session under the same (judgeModel,
 * judgePromptVersion) DELETEs its annotations and re-INSERTs (error sets can
 * shrink between runs, so upsert would leave stale rows). Different judge
 * versions coexist.
 *
 * Evidence (`userText`/`aiText`) is reconstructed from
 * scenario_session_messages at write time — the judge does NOT echo the
 * transcript (that would ~double output-token cost); `evidenceQuote` is the
 * judge's short verbatim span.
 */
@Index('language_error_annotations_session_id_idx', ['scenarioSessionId'])
@Index('language_error_annotations_judgment_id_idx', ['sessionJudgmentId'])
@Index('language_error_annotations_occurred_at_idx', ['occurredAt'])
@Index('language_error_annotations_language_idx', ['language'])
@Index('language_error_annotations_dimension_idx', ['dimension'])
@Entity('language_error_annotations')
export class LanguageErrorAnnotation extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Correlation -------------------------------------------------------------
  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /** FK → language_judgment_sessions.id (the run this annotation belongs to). */
  @Column({ type: 'uuid' })
  sessionJudgmentId!: string;

  @Column()
  turnIndex!: number;

  // The annotation (frozen typology v1) --------------------------------------
  /** comprehension | content | appropriateness — derived from dimension in code. */
  @Column()
  layer!: string;

  /** understanding | adequacy | fluency | coherence | register |
   *  dialect_lexicon | colloquialness | persona_social | codeswitch. */
  @Column()
  dimension!: string;

  /** Error category within the dimension (e.g. too_formal_diglossia). */
  @Column()
  category!: string;

  /** minor | major | critical (weights 1/5/10 applied at read time). */
  @Column()
  severity!: string;

  /** input_clean | input_garbled | persona_specified | persona_unspecified |
   *  pattern_systemic — the attribution basis (incl. prompt-vs-model side). */
  @Column({ nullable: true })
  isolationBasis?: string;

  /** STT quality of the counselor input this turn replied to: none | partial | severe. */
  @Column({ nullable: true })
  inputGarbled?: string;

  /** True when this error is conditioned out of its dimension's error rate
   *  (understanding/adequacy error on a garbled-input turn). */
  @Column({ default: false })
  conditionedOut!: boolean;

  /** Shortest verbatim span exhibiting the error (original script). */
  @Column({ type: 'text', nullable: true })
  evidenceQuote?: string;

  @Column({ type: 'text', nullable: true })
  reasoning?: string;

  // Evidence (reconstructed from messages, NOT emitted by the judge) ---------
  @Column({ type: 'text', nullable: true })
  userText?: string;

  @Column({ type: 'text', nullable: true })
  aiText?: string;

  // Denormalized slice dimensions (mirror language_judgment_sessions) --------
  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  @Column({ nullable: true })
  engine?: string;

  @Column({ nullable: true })
  llmModel?: string;

  @Column({ nullable: true })
  llmProvider?: string;

  @Column({ nullable: true })
  promptVersion?: string;

  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  // Judge provenance ----------------------------------------------------------
  @Column()
  judgeModel!: string;

  @Column({ default: 'v1' })
  judgePromptVersion!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
