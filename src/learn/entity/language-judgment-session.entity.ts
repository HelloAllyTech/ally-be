import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One row per session per language-judge run — the session-level record of the
 * language-quality judge (see language-eval-judge-schema.md). This row is the
 * DENOMINATOR: weighted error rate per 100 turns needs `turnsJudged` (and
 * `turnsGarbled` for the conditioned understanding/adequacy dimensions) even
 * for sessions with zero errors, which have no annotation rows at all.
 *
 * Data flow (single write path, two read surfaces): the judge writes these
 * rows once; the Roleplay Session Logs detail reads them raw per session; the
 * analytics dashboard aggregates the SAME rows. Nothing is computed twice.
 *
 * Denormalized slice dimensions mirror turn_drift_judgment so analytics is a
 * single-table query. Mutable eval data — re-judged rows coexist per
 * (judgeModel, judgePromptVersion); comparisons are only valid within one pair.
 */
@Index('language_judgment_sessions_session_id_idx', ['scenarioSessionId'])
@Index('language_judgment_sessions_occurred_at_idx', ['occurredAt'])
@Index('language_judgment_sessions_language_idx', ['language'])
@Index('language_judgment_sessions_scenario_id_idx', ['scenarioId'])
@Unique('language_judgment_sessions_session_judge_uq', [
  'scenarioSessionId',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('language_judgment_sessions')
export class LanguageJudgmentSession extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  // Denominators (computed by the judge's deterministic post-processing) ----
  /** AI-client turns judged in this session. */
  @Column()
  turnsJudged!: number;

  /** Judged turns whose counselor input was STT-garbled (partial or severe).
   *  Excluded from the understanding/adequacy denominators (conditioning). */
  @Column({ default: 0 })
  turnsGarbled!: number;

  /** Annotations the LLM emitted with an invalid category-for-dimension pair,
   *  dropped in code. Non-zero values are a rubric-tuning signal. */
  @Column({ default: 0 })
  droppedAnnotations!: number;

  // Objective per-session metrics (populated by Phase 2; nullable until then)
  /** % of AI turns rendered cleanly in the target script (0-100). */
  @Column({ type: 'float', nullable: true })
  scriptFidelityPct?: number;

  // Denormalized slice dimensions (copied from session/scenario at write time)
  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  /** SIMULATION | ROLEPLAY_V2 — both engines are judged; slice dimension. */
  @Column({ nullable: true })
  engine?: string;

  @Column({ nullable: true })
  llmModel?: string;

  @Column({ nullable: true })
  llmProvider?: string;

  /** TTS voice the session used (the round-trip-WER experiment axis). */
  @Column({ nullable: true })
  voiceId?: string;

  @Column({ nullable: true })
  voiceName?: string;

  /** Headline prompts_versions version the session ran with. */
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
