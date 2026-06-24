import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One row per AI-client turn, per judge run — the output of the conversation
 * drift judge (see drift-metrics-spec.md). An LLM judge reads a whole session
 * transcript and emits a per-turn array; each element becomes one row here.
 *
 * Wide-by-design and **denormalized** (mirrors scenario_session_turn_metrics):
 * `language` / `scenarioId` / `scenarioVersionId` / `llmModel` / `llmProvider` /
 * `promptVersion` are copied from the session/turn at write time so the
 * analytics dashboard can slice by them with a single-table query (no fragile
 * 4-way join).
 *
 * This is *mutable eval data* — re-run when the judge model or rubric changes —
 * which is why it lives in its own table and not as columns on turn_metrics.
 * The (session, turn, judgeModel, judgePromptVersion) unique key lets a re-judge
 * with a new rubric coexist with prior runs (and lets the job upsert).
 *
 * Evidence (`userText` / `aiText`) is reconstructed from
 * scenario_session_messages at write time — the judge does NOT echo it (echoing
 * the transcript back would ~double output-token cost).
 */
@Index('turn_drift_judgment_session_id_idx', ['scenarioSessionId'])
@Index('turn_drift_judgment_occurred_at_idx', ['occurredAt'])
@Index('turn_drift_judgment_language_idx', ['language'])
@Index('turn_drift_judgment_scenario_id_idx', ['scenarioId'])
@Index('turn_drift_judgment_scenario_version_id_idx', ['scenarioVersionId'])
@Unique('turn_drift_judgment_session_turn_judge_uq', [
  'scenarioSessionId',
  'turnIndex',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('turn_drift_judgment')
export class TurnDriftJudgment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Correlation -----------------------------------------------------------
  @Column({ type: 'uuid', nullable: true })
  scenarioSessionId?: string;

  @Column()
  turnIndex!: number;

  // Per-turn judge primitives (see spec §"The one LLM call") --------------
  /** Anchored ordinal: fully_coherent | minor_disfluency | degrading | mostly_incoherent | gibberish. */
  @Column({ nullable: true })
  coherence?: string;

  /** on_topic | tangent | off_topic | gibberish. */
  @Column({ nullable: true })
  topicLabel?: string;

  /** Is odd output realistic in-character distress rather than drift? */
  @Column({ nullable: true })
  inCharacter?: boolean;

  /** STT signal on the counselor's transcript: none | partial | severe. */
  @Column({ nullable: true })
  counselorUtteranceGarbled?: string;

  /** STT error sub-type when garbled: entity_swap | phonetic_garble | wrong_language | number_format | code_mix_fail | truncation. */
  @Column({ nullable: true })
  sttErrorType?: string;

  /** LLM failure sub-type: hallucination | context_lockin | wrong_language_reply | repetition | role_slip | wrong_intent | none. */
  @Column({ nullable: true })
  aiReplyFailureMode?: string;

  /** Root attribution (looks back ~3 turns): stt_direct | stt_cascade | llm_direct | context_lockin. */
  @Column({ nullable: true })
  rootAttribution?: string;

  @Column({ type: 'text', nullable: true })
  reasoning?: string;

  // Evidence (reconstructed from messages, NOT emitted by the judge) -------
  @Column({ type: 'text', nullable: true })
  userText?: string;

  @Column({ type: 'text', nullable: true })
  aiText?: string;

  // Denormalized slice dimensions (copied from session/turn at write time) -
  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  scenarioId?: number;

  /** scenario_versions row the session ran against (experiment dimension). */
  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  @Column({ nullable: true })
  llmModel?: string;

  @Column({ nullable: true })
  llmProvider?: string;

  /** Immutable prompts_versions id the session ran with (experiment dimension). */
  @Column({ nullable: true })
  promptVersion?: string;

  // Session rollup, denormalized onto every turn of the session (computed by
  // the judge's code rule) so the dashboard can compute drift RATE with a
  // simple `COUNT(DISTINCT session) FILTER (WHERE sessionDrifted)` — no
  // per-session consecutive-run logic in SQL.
  @Column({ nullable: true })
  sessionDrifted?: boolean;

  @Column({ nullable: true })
  firstDriftTurn?: number;

  /** Turn timestamp (from turn_metrics / message timing), for time-bucketing. */
  @Column({ type: 'timestamp', nullable: true })
  occurredAt?: Date;

  // Judge provenance (part of the uniqueness key) -------------------------
  /** Which judge model produced this row, e.g. 'gemini-2.5-pro'. */
  @Column()
  judgeModel!: string;

  /** Version of the judge rubric/prompt, so re-judges are distinguishable. */
  @Column({ default: 'v1' })
  judgePromptVersion!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
