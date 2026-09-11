import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One verdict on one turn's recall.
 *
 * The selection row records what was chosen and every score behind it; this records whether the
 * choice was right. Labels only, no scalar score — rates are computed at read time, so
 * "recall accuracy" can be re-cut without re-judging a month of turns.
 *
 * `verdict` is one of:
 *   `no_demand`     the turn called for no particular backstory (most turns)
 *   `well_chosen`   it did, and the recalled facts covered it
 *   `missed_better` it did, and a passed-over fact answered it better — a RANKING failure
 *   `nothing_apt`   it did, and neither list held anything apt — a CORPUS gap
 *
 * Read `missed_better` against `no_demand` rather than against the total: a session of
 * acknowledgements is not evidence that recall works, and the two failure verdicts point at
 * different fixes.
 */
@Unique('wm_recall_judgment_judge_uq', [
  'recallSelectionId',
  'judgeModel',
  'judgePromptVersion',
])
@Index('wm_recall_judgment_verdict_idx', ['verdict'])
@Index('wm_recall_judgment_session_idx', ['scenarioSessionId'])
@Index('wm_recall_judgment_occurred_at_idx', ['occurredAt'])
@Entity('wm_recall_judgments')
export class WmRecallJudgment extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recall_selection_id', type: 'uuid' })
  recallSelectionId!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  turnIndex!: number;

  @Column({ type: 'varchar', length: 32 })
  verdict!: string;

  /**
   * On `missed_better` only: the passed-over fact that should have been recalled, quoted from
   * the candidates the judge was shown. Null when the judge named one that was not in the
   * pool — the verdict survives, the invented quote does not, because stored as-is it would
   * send someone to retune a weight over material that never existed.
   */
  @Column({ name: 'better_fact', type: 'text', nullable: true })
  betterFact?: string | null;

  /**
   * How many recalled facts the turn gave no occasion for. A count rather than the texts: one
   * or two is normal, and the signal is a persistently high number — which would mean the cap
   * of five is larger than the conversation can use.
   */
  @Column({ name: 'unused_selected_count', type: 'int', default: 0 })
  unusedSelectedCount!: number;

  @Column({ type: 'text', nullable: true })
  reasoning?: string | null;

  // Denormalised slice dimensions ------------------------------------------
  /** A guarded client withholding a fact recalled it fine; segment before reading a rate. */
  @Column({ nullable: true })
  stance?: string;

  /** `scenario` means nothing in the conversation drove the selection at all. */
  @Column({ name: 'cue_tier', nullable: true })
  cueTier?: string;

  @Column({ name: 'pool_size', type: 'int', default: 0 })
  poolSize!: number;

  /** When the TURN happened, not when it was judged. Trends read on this. */
  @Column({ name: 'occurred_at', type: 'timestamp' })
  occurredAt!: Date;

  // Judge provenance ---------------------------------------------------------
  /** The model that ACTUALLY ran, as ally-ai reports it — never the configured one. */
  @Column({ name: 'judge_model', type: 'varchar', length: 64 })
  judgeModel!: string;

  @Column({
    name: 'judge_prompt_version',
    type: 'varchar',
    length: 16,
    default: 'v1',
  })
  judgePromptVersion!: string;
}
