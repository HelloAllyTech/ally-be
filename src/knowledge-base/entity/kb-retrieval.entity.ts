import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  KbCharacterTopic,
  KbCorpus,
  KbRetrievalConsumer,
  KbRetrievalDisposition,
} from '../enum/knowledge-base.enum';

/**
 * One retrieval, recorded so the numbers that govern retrieval can be chosen from data.
 *
 * This table exists because of a specific embarrassment. The character corpus's similarity
 * floor was set to 0.5 by reasoning about what "actually close" ought to mean; the first real
 * measurement — a passage explicitly about repeated questioning, matched against a query
 * explicitly asking about repeated questioning — scored 0.5056. The floor was one paraphrase
 * away from rejecting a direct hit, and nothing in the system would have said so. A cosine
 * similarity is not calibrated across queries or corpora, so a floor picked without the
 * distribution in front of you is a guess wearing a decimal point.
 *
 * With this table plus its passage rows, the floor becomes a question with an answer: join
 * similarity to a judge's relevance label and read precision and recall off the curve at every
 * candidate threshold. It can also return a harder verdict — if relevant passages score 0.42
 * while irrelevant ones score 0.44, similarity is not separable for this corpus and no
 * threshold will fix it. That conclusion argues for reranking or hybrid retrieval, and it can
 * only be reached with the distribution in hand.
 *
 * MEASUREMENT, NOT MITIGATION. Nothing here improves a single retrieval. It tells us what to
 * change.
 *
 * Written fire-and-forget: a failure to log must never fail the retrieval it describes.
 *
 * NOT the WhatsApp answering path. That retrieves inside ally-ai in one call
 * (`answerKnowledgeQuestion`) and never passes through the service that writes here, so a
 * health worker's question does not land in this table. What does is an admin's own console
 * queries and the interview agent's, neither of which is PHI.
 */
@Entity('kb_retrievals')
export class KbRetrieval extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_kb_retrievals_corpus')
  @Column({ type: 'varchar', length: 32 })
  corpus!: KbCorpus;

  /**
   * Segment by this before believing any trend. An operator probing thresholds in the admin
   * preview generates deliberately strange queries, repeatedly, usually against material they
   * uploaded a minute ago — pooled with the agent's traffic, an afternoon of tuning moves the
   * very distribution the tuning was meant to read.
   */
  @Index('idx_kb_retrievals_consumer')
  @Column({ type: 'varchar', length: 32 })
  consumer!: KbRetrievalConsumer;

  /**
   * The query as issued. Stored verbatim because the most useful analysis is qualitative:
   * reading the queries that returned nothing is how you find out whether the corpus has a gap
   * or the agent is asking badly, and no aggregate distinguishes those.
   */
  @Column({ type: 'text' })
  query!: string;

  @Column({
    name: 'character_topics',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  characterTopics!: KbCharacterTopic[];

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /**
   * The floor this retrieval actually used, not the current default. A row that recorded the
   * setting rather than the value would be worthless the first time the default changed —
   * which is the whole reason this table exists.
   */
  @Column({ type: 'real', name: 'min_similarity' })
  minSimilarity!: number;

  @Column({ type: 'int', name: 'requested_limit' })
  requestedLimit!: number;

  /** What was asked of ally-ai per pass — larger than the limit, since shaping only removes. */
  @Column({ type: 'int', name: 'fetch_limit' })
  fetchLimit!: number;

  /** How many documents the curator's topic mapping put in each bucket. */
  @Column({ type: 'int', name: 'preferred_document_count' })
  preferredDocumentCount!: number;

  @Column({ type: 'int', name: 'rest_document_count' })
  restDocumentCount!: number;

  @Column({ type: 'int', name: 'first_pass_hits' })
  firstPassHits!: number;

  /**
   * NULL when the top-up never ran, which is different from 0 and must stay different: null
   * means the mapped documents filled the limit on their own (the boost worked), 0 means the
   * rest of the corpus was searched and had nothing (the corpus has a gap).
   */
  @Column({ type: 'int', name: 'second_pass_hits', nullable: true })
  secondPassHits?: number | null;

  @Column({ type: 'int', name: 'returned_count' })
  returnedCount!: number;

  @Column({ type: 'int', name: 'latency_ms' })
  latencyMs!: number;

  /**
   * The threshold the CONSUMER declines under, when it has one.
   *
   * Distinct from `minSimilarity`, which is the search floor. The WhatsApp bot searches at one
   * number and refuses to answer under a second, higher one, so a passage can clear retrieval
   * and still never reach a worker. Calibrating that corpus means seeing both.
   */
  @Column({ type: 'real', name: 'decline_similarity', nullable: true })
  declineSimilarity?: number | null;

  /**
   * What the consumer did with the result. Null for consumers with no decline step — the admin
   * preview shows whatever comes back, and the interview agent decides in its own reasoning
   * rather than at a threshold.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  disposition?: KbRetrievalDisposition | null;

  /**
   * Language the query was searched in. The bot translates a worker's question before
   * retrieving, and a weak result on a failed translation says nothing about the corpus.
   */
  @Column({
    type: 'varchar',
    length: 16,
    name: 'query_language',
    nullable: true,
  })
  queryLanguage?: string | null;

  /**
   * True when `query` is someone's own words rather than an operator's or an agent's.
   *
   * The WhatsApp bot's queries are health workers' questions, so they are PHI-adjacent by
   * default here. The flag exists so every read surface can withhold the text from one rule in
   * data rather than each caller having to know which consumers are sensitive: the analytics
   * response returns null for these, and `analytics_agent_kb_retrievals` nulls the column
   * before the Analytics Agent's model-authored SQL can reach it.
   */
  @Column({ type: 'boolean', name: 'query_sensitive', default: false })
  querySensitive!: boolean;

  /** The interview session this served, when a session drove it. */
  @Index('idx_kb_retrievals_session_id')
  @Column({ type: 'uuid', name: 'session_id', nullable: true })
  sessionId?: string | null;

  @Column({ name: 'created_by', type: 'int', nullable: true })
  createdBy?: number | null;
}
