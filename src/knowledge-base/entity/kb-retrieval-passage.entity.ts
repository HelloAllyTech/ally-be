import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  KbRetrievalOutcome,
  KbRetrievalPass,
} from '../enum/knowledge-base.enum';

/**
 * One candidate passage a retrieval considered — including the ones it discarded.
 *
 * The discards are the point. A retrieval that returns three good passages looks identical
 * whether it discarded nothing or discarded eleven near-duplicates of the same paragraph, and
 * those are different systems: the second has a chunk profile cutting mid-thought, or one
 * document answering every question. Storing only survivors would leave that invisible,
 * because survivors are by definition the ones that looked fine.
 *
 * This is also the table a relevance judge attaches to. `similarity` here joined to a label
 * there is what turns the similarity floor from a judgement call into a precision/recall
 * curve — see KbRetrieval for why that mattered enough to build.
 */
@Entity('kb_retrieval_passages')
export class KbRetrievalPassage extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_kb_retrieval_passages_retrieval_id')
  @Column({ type: 'uuid', name: 'retrieval_id' })
  retrievalId!: string;

  /**
   * The chunk, as ally-be knows it — kb_document_chunks.id, which is also the Weaviate object
   * uuid. No foreign key: a re-chunk writes new rows under new ids and deletes the old
   * generation, and a citation recorded here must still identify what was actually retrieved
   * at the time even after that. An FK would either block the re-chunk or erase the history.
   */
  @Column({ type: 'uuid', name: 'chunk_id' })
  chunkId!: string;

  @Index('idx_kb_retrieval_passages_document_id')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  /** Position in the merged candidate list, 1-based. Preferred-pass candidates come first. */
  @Column({ type: 'int' })
  rank!: number;

  /**
   * Indexed because the distribution is the primary query: "what did relevant passages score,
   * and what did irrelevant ones score" is a scan over this column and nothing else.
   */
  @Index('idx_kb_retrieval_passages_similarity')
  @Column({ type: 'real' })
  similarity!: number;

  @Column({ type: 'varchar', length: 16 })
  pass!: KbRetrievalPass;

  @Index('idx_kb_retrieval_passages_outcome')
  @Column({ type: 'varchar', length: 32 })
  outcome!: KbRetrievalOutcome;
}
