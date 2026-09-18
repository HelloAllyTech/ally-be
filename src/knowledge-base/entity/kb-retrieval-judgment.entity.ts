import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { KbCorpus, KbRetrievalConsumer } from '../enum/knowledge-base.enum';

/**
 * One retrieval, judged: did what came back actually answer what was asked?
 *
 * `kb_retrievals` records what was retrieved and at what similarity. It cannot record whether
 * that was any good, and similarity does not answer it — production returned zero passages for
 * "how specific should a character be" against a document whose section was titled "Specific
 * beats representative, every time", and the scores were the only thing the log had to say
 * about it. A label is the missing half.
 *
 * SUFFICIENCY IS THE ROW'S POINT, and specifically its `missing` text. A retrieval that came
 * back with nothing looks identical whether the corpus lacks the material or the floor was set
 * too tight, and those have opposite fixes: upload something, or lower a number. The judge is
 * asked what it would have needed, which is the only signal that separates them, and it is
 * asked even when nothing was returned — an empty retrieval is the most informative row here,
 * not a row to skip.
 *
 * Labels only, no scores, like every other judgment table on this platform. Sufficiency rates
 * are computed at read time, so the definition of "sufficient enough" can be re-cut without
 * re-judging a month of traffic.
 *
 * The slice columns are denormalised (corpus, consumer, min_similarity, returned_count) for the
 * reason the language judge learned the hard way: a rate that mixes populations reports a
 * traffic-mix change as a quality change. An operator probing thresholds in the admin preview
 * and the interview agent's real queries must never be read as one number, and having `consumer`
 * on this row means the segmenting query cannot forget to join for it.
 *
 * The unique key includes the judge's model and rubric version, so a re-judge under a new rubric
 * lands alongside the old verdict instead of overwriting it, and an interrupted backfill is
 * resumable — "already judged" means judged by THIS pair.
 */
@Index('idx_kb_retrieval_judgments_retrieval_id', ['retrievalId'])
@Index('idx_kb_retrieval_judgments_sufficiency', ['sufficiency'])
@Index('idx_kb_retrieval_judgments_occurred_at', ['occurredAt'])
@Unique('kb_retrieval_judgments_judge_uq', [
  'retrievalId',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('kb_retrieval_judgments')
export class KbRetrievalJudgment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'retrieval_id' })
  retrievalId!: string;

  /** sufficient | partial | nothing_useful. */
  @Column({ type: 'varchar', length: 16 })
  sufficiency!: string;

  /**
   * What the judge would have needed and did not get, in its own words.
   *
   * Prose rather than a category, because the useful reading of this column is qualitative:
   * a dozen rows all asking for the same thing is a corpus gap with a name, and no enum
   * invented up front would have had that name in it.
   */
  @Column({ type: 'text', nullable: true })
  missing?: string | null;

  /**
   * How many passages carried a label, and how many the judge left alone.
   *
   * Skipped passages are recorded rather than silently absorbed: a per-passage precision figure
   * computed over a judgment that quietly ignored half the retrieval is wrong in the direction
   * that looks fine.
   */
  @Column({ type: 'int', name: 'passages_judged', default: 0 })
  passagesJudged!: number;

  @Column({ type: 'int', name: 'passages_skipped', default: 0 })
  passagesSkipped!: number;

  // Denormalised slice dimensions -------------------------------------------
  @Column({ type: 'varchar', length: 32 })
  corpus!: KbCorpus;

  @Index('idx_kb_retrieval_judgments_consumer')
  @Column({ type: 'varchar', length: 32 })
  consumer!: KbRetrievalConsumer;

  /** The floor that retrieval actually ran at — the number this table exists to calibrate. */
  @Column({ type: 'real', name: 'min_similarity' })
  minSimilarity!: number;

  @Column({ type: 'int', name: 'returned_count' })
  returnedCount!: number;

  /** When the RETRIEVAL happened, not when it was judged. Trends are read on this. */
  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;

  // Judge provenance ---------------------------------------------------------
  /**
   * The model that ACTUALLY ran, as ally-ai reports it — not the one configured. A fallback
   * recorded under the configured name silently mixes two judges into one pinned series.
   */
  @Column({ type: 'varchar', length: 64, name: 'judge_model' })
  judgeModel!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'judge_prompt_version',
    default: 'v1',
  })
  judgePromptVersion!: string;
}
