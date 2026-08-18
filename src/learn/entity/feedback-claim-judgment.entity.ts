import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One post-session feedback CLAIM, judged against the session transcript.
 *
 * The feedback a learner receives is the only output they are graded by, and
 * until this table nothing checked whether it was true. Delivery was measured
 * (metric 8) and score discrimination was measured (metric 2); correctness was
 * not measured at all.
 *
 * Shape follows language_error_annotations deliberately — one row per judged
 * unit, no scalar scores anywhere. The judge returns an enum verdict and two
 * booleans; support rates and per-100 figures are computed at read time from
 * these rows, so a definition can be re-cut without re-judging a year of
 * feedback.
 *
 * Slice columns are denormalised (language, scenarioId, llmModel, occurredAt)
 * for the same reason as the other judgment tables: the dashboard slices with a
 * single-table query rather than a four-way join.
 *
 * The unique key lets a re-judge under a new rubric coexist with prior runs
 * rather than overwriting them, and makes the backfill idempotent — re-issuing
 * an interrupted run skips what already landed.
 */
@Index('feedback_claim_judgment_session_id_idx', ['scenarioSessionId'])
@Index('feedback_claim_judgment_occurred_at_idx', ['occurredAt'])
@Index('feedback_claim_judgment_verdict_idx', ['verdict'])
@Unique('feedback_claim_judgment_claim_judge_uq', [
  'scenarioSessionId',
  'claimKind',
  'claimIndex',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('feedback_claim_judgment')
export class FeedbackClaimJudgment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  /** positive | improvement — the two fail in opposite directions. */
  @Column()
  claimKind!: string;

  /** Position within its list, 0-based. */
  @Column()
  claimIndex!: number;

  /**
   * supported | unsupported | contradicted | misattributed.
   *
   * `contradicted` on an `improvement` is the harmful case: the learner is
   * told they failed to do something the transcript shows them doing.
   */
  @Column()
  verdict!: string;

  /** Claim cites specific words as spoken, rather than describing behaviour. */
  @Column({ type: 'boolean', nullable: true })
  quotesTranscript?: boolean;

  /** Only when quotesTranscript: does that wording appear in the transcript? */
  @Column({ type: 'boolean', nullable: true })
  quoteIsAccurate?: boolean;

  /** The claim text as judged, so a verdict can be read without re-joining. */
  @Column({ type: 'text', nullable: true })
  claimText?: string;

  @Column({ type: 'text', nullable: true })
  reasoning?: string;

  // Denormalised slice dimensions ------------------------------------------
  @Column({ nullable: true })
  language?: string;

  @Column({ nullable: true })
  scenarioId?: number;

  @Column({ type: 'uuid', nullable: true })
  scenarioVersionId?: string;

  @Column({ nullable: true })
  llmModel?: string;

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
