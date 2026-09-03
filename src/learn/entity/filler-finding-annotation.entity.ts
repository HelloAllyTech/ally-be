import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per finding per judge run — what the thinking-filler judge found
 * wrong with a played filler (see ally-ai's `docs/filler-eval-judge-schema.md`).
 *
 * MOST PLAYED FILLERS HAVE NO ROW HERE. "Hmm" is a correct, complete filler; a
 * clean session produces none of these, and its denominator lives in
 * `filler_judgment_sessions`, which every judged session gets. A rubric that
 * produced a row per filler would be a rubric that had started manufacturing
 * faults.
 *
 * NO scalar quality scores anywhere — findings carry dimension/category/severity
 * and the rate per 100 played fillers is computed at read time from these rows
 * plus the session-row denominators. Same rule as every other judge here.
 *
 * Idempotency: re-judging a session under the same (judgeModel,
 * judgePromptVersion) DELETEs its findings and re-INSERTs — finding sets can
 * shrink between runs, so an upsert would leave stale rows behind.
 */
@Index('filler_finding_annotations_session_id_idx', ['scenarioSessionId'])
@Index('filler_finding_annotations_judgment_id_idx', ['sessionJudgmentId'])
@Index('filler_finding_annotations_occurred_at_idx', ['occurredAt'])
@Index('filler_finding_annotations_language_idx', ['language'])
@Index('filler_finding_annotations_dimension_idx', ['dimension'])
@Entity('filler_finding_annotations')
export class FillerFindingAnnotation extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Correlation -------------------------------------------------------------
  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /** FK → filler_judgment_sessions.id (the run this finding belongs to). */
  @Column({ type: 'uuid' })
  sessionJudgmentId!: string;

  @Column()
  turnIndex!: number;

  // The finding (frozen typology v1) ----------------------------------------
  /** character_fit | context_fit | safety. */
  @Column()
  dimension!: string;

  /**
   * character_fit: generic_for_character | wrong_register | persona_break
   * context_fit:   answers_earlier_turn | incongruous_reaction
   * safety:        committed | echoes_specific
   */
  @Column()
  category!: string;

  /** minor | major | critical. */
  @Column()
  severity!: string;

  /**
   * True when this finding depends on a configured character style the
   * scenario never had — calling a filler "generic" on a character who was
   * never given a voice blames the model for a configuration gap.
   *
   * Kept rather than dropped, because it still says something true about the
   * scenario; excluded from the model-facing rate so a push to configure more
   * scenarios does not read as a model regression.
   */
  @Column({ default: false })
  conditionedOut!: boolean;

  /** Shortest verbatim span exhibiting the finding (original script). */
  @Column({ type: 'text', nullable: true })
  evidenceQuote?: string;

  @Column({ type: 'text', nullable: true })
  reasoning?: string;

  // What was actually played (joined in at write time, not echoed by the LLM) -
  /** The filler phrase the learner heard. */
  @Column({ type: 'text', nullable: true })
  fillerText?: string;

  /**
   * Where the phrase came from: static | seed | exchange | in_turn.
   *
   * Worth slicing on: `in_turn` is the only generation path that had seen the
   * learner's current utterance, so a context_fit finding rate that is markedly
   * lower there is the evidence that the path earns its extra call.
   */
  @Column({ nullable: true })
  source?: string;

  /** hesitation | acknowledgement | reflection | encouragement. */
  @Column({ nullable: true })
  fillerType?: string;

  // Denormalized slice dimensions (mirror filler_judgment_sessions) ---------
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

  // Judge provenance --------------------------------------------------------
  @Column()
  judgeModel!: string;

  @Column({ default: 'v1' })
  judgePromptVersion!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
