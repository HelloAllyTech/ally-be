import { BaseEntity } from 'src/common/entity/base.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * One row per turn of the voice agent's working-memory recall: what it chose, and what it
 * passed over.
 *
 * WHY THIS IS NOT IN THE RETRIEVAL LOG. `kb_retrievals` measures similarity search against a
 * floor. Recall is a RANKING with several terms — cue hits, semantic similarity, encoding
 * strength, recency decay, stance congruence — and a hard cap of five; nothing is admitted or
 * rejected by a threshold. A precision curve over a floor would describe a mechanism that does
 * not exist here, so this is its own table with its own question: was the fact the turn needed
 * in the pool and passed over?
 *
 * WHY IT EXISTS AT ALL. `recall.select` has always returned every score it considered, and its
 * docstring says the return value is "what makes the coefficients above tunable from production
 * rather than from argument". Its only call site discarded it, every turn, since the feature
 * shipped — so those weights have never been tunable from anything but argument. One concrete
 * consequence already on record: the first v2v run had cue_hits at 0 on every turn, meaning
 * recall was selecting by encoding strength and decay while appearing to respond to the
 * conversation. `cueTier` exists so that is visible in a count rather than by reading
 * transcripts.
 *
 * THE PASSED-OVER CANDIDATES ARE THE POINT. A fact that scored just under the cap is the
 * evidence that the cap or a weight is wrong, and the selection alone can never show it.
 *
 * JSONB rather than a row per candidate: a reader — and the judge that will read this — wants
 * one turn's whole decision at once, and there is no query that wants a single candidate in
 * isolation. Storing five to ten rows per turn per session would triple the table to serve
 * nobody.
 *
 * NO LEARNER TEXT. `cueTier` says which SOURCE supplied the cues, not what they said, and the
 * turn's own words already live in `scenario_session_messages`. A judge joins to that by
 * session and turn rather than having session content duplicated into an analytics table.
 */
// One row per (session, turn). The write path is a blind insert behind an at-least-once SQS
// queue, and without this a redelivery would double a turn and every aggregate over it — the
// same defence scenario_session_turn_metrics needs for the same reason.
@Unique('wm_recall_selection_session_turn_uq', [
  'scenarioSessionId',
  'turnIndex',
])
@Index('wm_recall_selection_session_idx', ['scenarioSessionId'])
@Index('wm_recall_selection_cue_tier_idx', ['cueTier'])
@Entity('wm_recall_selections')
export class WmRecallSelection extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  scenarioSessionId!: string;

  @Column({ type: 'int' })
  turnIndex!: number;

  /** The stance the update had just decided — recall is scored for congruence with it. */
  @Column({ nullable: true })
  stance?: string;

  /**
   * Which source supplied this turn's cues: `nominated` (the off-path updater named topics),
   * `learner_text` (the learner's own last words), `scenario` (the scenario description, which
   * is where the opening turn and any "mm-hmm" land), or `none`.
   *
   * Indexed because the distribution is the primary question. A session running mostly on
   * `scenario` is a session whose client is recalling by encoding strength while looking
   * responsive.
   */
  @Column({ name: 'cue_tier' })
  cueTier!: string;

  @Column({ name: 'cue_count', type: 'int', default: 0 })
  cueCount!: number;

  /** Facts available to choose from, and the cap that bound the choice. */
  @Column({ name: 'pool_size', type: 'int', default: 0 })
  poolSize!: number;

  @Column({ type: 'int', default: 0 })
  cap!: number;

  /**
   * What the client had in mind, each with every term that decided it: score, cue_hits,
   * similarity, mood_congruent, spread, encoding_strength, last_recalled_turn, stances_seen.
   * A score without its components is a number nobody can act on — it cannot say whether the
   * cue weighting or the decay curve produced it.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  selected!: Record<string, unknown>[];

  /** The near misses, highest-scoring first, in the same shape. */
  @Column({ name: 'passed_over', type: 'jsonb', default: () => "'[]'" })
  passedOver!: Record<string, unknown>[];
}
