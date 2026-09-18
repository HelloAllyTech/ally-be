import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import {
  KbCorpus,
  KbRetrievalConsumer,
  KbRetrievalOutcome,
  KbRetrievalPass,
} from '../enum/knowledge-base.enum';

/**
 * One candidate passage, labelled for whether it was any use.
 *
 * This is the row that turns the similarity floor from a judgement call into a curve. Joining
 * `similarity` to `relevance` gives precision at every candidate threshold, and it can return a
 * harder verdict than a better number: if relevant passages score 0.42 while irrelevant ones
 * score 0.44, similarity is not separable for this corpus and no floor will fix it — that
 * conclusion argues for reranking or hybrid retrieval and can only be reached with the
 * distribution in hand.
 *
 * `superficial_match` is separate from `relevance` on purpose. "Irrelevant" says the passage did
 * not answer the query; "irrelevant AND superficially matched" says it scored well anyway, on
 * shared vocabulary while talking about something else. The first is a corpus fact, the second is
 * an embedding fact, and only the second is an argument for changing how retrieval ranks.
 *
 * WHAT THIS CANNOT MEASURE, stated so nobody reads it as more than it is: every row here already
 * cleared the floor, because the log only ever sees what ally-ai returned. So these labels give
 * PRECISION and never the RECALL of what the floor rejected. Measuring that needs the same
 * queries re-run at a lower floor — by hand today, through the retrieval preview's floor control.
 *
 * Dropped candidates are judged too, and that is the other half of the value: a retrieval that
 * returned three good passages looks the same whether it discarded nothing or discarded something
 * better. Labelling the discards is how the document cap and the span-overlap rule get checked
 * against something other than their own reasoning.
 *
 * Slice columns are denormalised so the precision curve is one table scan and cannot forget to
 * segment by consumer — see KbRetrievalJudgment for why that segmentation is not optional.
 */
@Index('idx_kb_retrieval_passage_judgments_retrieval_id', ['retrievalId'])
@Index('idx_kb_retrieval_passage_judgments_relevance', ['relevance'])
@Index('idx_kb_retrieval_passage_judgments_similarity', ['similarity'])
@Unique('kb_retrieval_passage_judgments_judge_uq', [
  'passageId',
  'judgeModel',
  'judgePromptVersion',
])
@Entity('kb_retrieval_passage_judgments')
export class KbRetrievalPassageJudgment extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The candidate row this labels — kb_retrieval_passages.id. */
  @Column({ type: 'uuid', name: 'passage_id' })
  passageId!: string;

  @Column({ type: 'uuid', name: 'retrieval_id' })
  retrievalId!: string;

  /**
   * Carried alongside the passage id so a label survives what the chunk does not. A re-chunk
   * writes new chunk rows under new ids; this records which chunk was actually judged at the
   * time, and no foreign key, for the same reason the passage row has none.
   */
  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Index('idx_kb_retrieval_passage_judgments_document_id')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  /**
   * relevant | tangential | irrelevant.
   *
   * Three, not a yes/no, because the middle one is a real and common outcome — material about
   * the right subject that does not answer the question asked — and collapsing it into either
   * neighbour loses the distinction that decides what to do. Tangential passages at high
   * similarity are a chunking problem; irrelevant ones are a ranking problem.
   */
  @Column({ type: 'varchar', length: 16 })
  relevance!: string;

  /** Scored well on shared wording while answering something else. */
  @Column({ type: 'boolean', name: 'superficial_match', default: false })
  superficialMatch!: boolean;

  @Column({ type: 'text', nullable: true })
  reasoning?: string | null;

  // Denormalised slice dimensions -------------------------------------------
  /** The score this passage got. The whole point of the join, kept on the row. */
  @Column({ type: 'real' })
  similarity!: number;

  /** Whether it was returned, or which shaping rule dropped it. */
  @Index('idx_kb_retrieval_passage_judgments_outcome')
  @Column({ type: 'varchar', length: 32 })
  outcome!: KbRetrievalOutcome;

  /** The curator's topic boost, or the top-up pass. */
  @Column({ type: 'varchar', length: 16 })
  pass!: KbRetrievalPass;

  @Column({ type: 'varchar', length: 32 })
  corpus!: KbCorpus;

  @Index('idx_kb_retrieval_passage_judgments_consumer')
  @Column({ type: 'varchar', length: 32 })
  consumer!: KbRetrievalConsumer;

  @Column({ type: 'timestamp', name: 'occurred_at' })
  occurredAt!: Date;

  // Judge provenance ---------------------------------------------------------
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
