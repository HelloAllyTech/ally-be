import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One row per session per thinking-filler judge run (see ally-ai's
 * `docs/filler-eval-judge-schema.md`). Sibling of `language_judgment_sessions`,
 * same seam, same reasoning.
 *
 * A thinking filler is the short back-channel the AI client utters the instant
 * the learner stops speaking, while its real reply is still forming. Its SPEED
 * is already measured per turn in `scenario_session_turn_metrics`. Its QUALITY
 * had no home at all, and the gap is not neutral: because the filler is the
 * character's first words, `responseLatencyMs` is measured to it, so a filler
 * that lands instantly but sounds nothing like the character improves every
 * latency chart while making the roleplay worse. These rows are what makes that
 * visible.
 *
 * This row is the DENOMINATOR: a finding rate per 100 played fillers needs
 * `fillersJudged` even for sessions with zero findings, which have no
 * annotation rows at all.
 *
 * NO scalar quality scores — the judge emits labelled findings and the rates
 * are computed at read time, the same rule every other judge on this platform
 * follows.
 *
 * Mutable eval data: re-judged rows coexist per (judgeModel,
 * judgePromptVersion); comparisons are only valid within one pair.
 */
@Index('filler_judgment_sessions_session_id_idx', ['scenarioSessionId'])
@Index('filler_judgment_sessions_occurred_at_idx', ['occurredAt'])
@Index('filler_judgment_sessions_language_idx', ['language'])
@Index('filler_judgment_sessions_scenario_id_idx', ['scenarioId'])
@Unique('filler_judgment_sessions_session_judge_uq', [
  'scenarioSessionId',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('filler_judgment_sessions')
export class FillerJudgmentSession extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  // Denominators -----------------------------------------------------------
  /** Fillers the learner actually heard and the judge scored. */
  @Column()
  fillersJudged!: number;

  /**
   * Distinct phrases / total played, 0-1. The one number a latency dashboard
   * structurally cannot show: a session can mask every gap perfectly and still
   * sound like a soundboard because it played the same three phrases.
   * Computed in ally-ai from the sequence of plays, not judged.
   */
  @Column({ type: 'float', nullable: true })
  distinctPhraseRatio?: number;

  /** Played fillers whose phrase had already been heard inside the recent
   *  window. Counted in PLAYS, not turns — one turn can play two fillers. */
  @Column({ default: 0 })
  repeatedFillers!: number;

  /** Findings the LLM emitted with an invalid category-for-dimension pair, or
   *  naming a filler we never sent. Dropped in code; non-zero is a
   *  rubric-tuning signal rather than a data problem. */
  @Column({ default: 0 })
  droppedAnnotations!: number;

  // Denormalized slice dimensions (mirror language_judgment_sessions) -------
  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  /** SIMULATION | ROLEPLAY_V2 — slice dimension. */
  @Column({ nullable: true })
  engine?: string;

  @Column({ nullable: true })
  llmModel?: string;

  @Column({ nullable: true })
  llmProvider?: string;

  @Column({ nullable: true })
  voiceId?: string;

  @Column({ nullable: true })
  voiceName?: string;

  @Column({ nullable: true })
  promptVersion?: string;

  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  // Judge provenance (part of the uniqueness key) --------------------------
  @Column()
  judgeModel!: string;

  @Column({ default: 'v1' })
  judgePromptVersion!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
