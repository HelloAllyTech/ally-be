import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  KbCharacterTopic,
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';

/**
 * One document in a knowledge corpus, and the system of record for it.
 *
 * ally-ai's KnowledgeChunk collection is a DERIVED index over the chunks of these rows —
 * same ownership rule as reference documents and roadmap opportunities. Postgres is truth;
 * vectors can always be rebuilt from here.
 *
 * `corpus` is what separates one consumer's material from another's. The WhatsApp Q&A bot
 * was the first, and this table was named and documented for it; the pipeline itself never
 * cared. Retrieval resolves ONE corpus's document ids here and passes them to ally-ai as
 * the query's own `document_ids`, so corpus scope is an argument rather than a filter — see
 * KbCorpus.
 *
 * NO tenant COLUMN, which is not the same as no audience. Within a corpus, a document is
 * targetable at one, some or all organisations via `isGlobal` plus `kb_document_tenants` —
 * the same two-part shape scenarios, tracks and cases already use — rather than by owning a
 * single tenant, because the material is curated centrally and the same clinical guide is
 * usually shared by many customers.
 *
 * The two scopes are different mechanisms on purpose. A CORPUS is one of a few fixed,
 * disjoint sets, so it gets its own vector collection and its ids travel as the query's
 * scope. An ORGANISATION is one of hundreds and a single document belongs to several, so it
 * gets a filter inside the collection. That is also what retires the older rule here — that
 * a per-tenant corpus should be a NEW collection rather than a filter, because "retrieval
 * that forgets a filter leaks, and an un-set filter is the easiest thing in the world to
 * forget". A collection per tenant does not survive one document shared by three of them,
 * so the warning is answered structurally instead: ally-ai's retrieval takes a REQUIRED
 * audience argument, and this platform refuses to answer a WhatsApp contact whose
 * organisation it could not resolve rather than falling back to something plausible.
 */
@Entity('kb_documents')
export class KbDocument extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Which consumer's material this is. Immutable in practice: moving a document between
   * corpora would change what every recorded citation over it meant.
   */
  @Index('idx_kb_documents_corpus')
  @Column({ type: 'varchar', length: 32, default: KbCorpus.WHATSAPP_QA })
  corpus!: KbCorpus;

  /**
   * Which parts of a character this document helps ground — a curator's hint that
   * BOOSTS those topics in retrieval rather than restricting to them. Empty means
   * "no hint", which is a perfectly good answer and the default. Only meaningful
   * for the character-library corpus.
   */
  @Column({
    name: 'character_topics',
    type: 'text',
    array: true,
    default: () => "'{}'",
  })
  characterTopics!: KbCharacterTopic[];

  @Index('idx_kb_documents_title')
  @Column({ type: 'text' })
  title!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'source_type',
    default: KbDocumentSourceType.PASTE,
  })
  sourceType!: KbDocumentSourceType;

  /** Set for sourceType=URL. Also rendered in a citation when present. */
  @Column({ type: 'text', name: 'source_url', nullable: true })
  sourceUrl?: string | null;

  /** S3 object for an uploaded pdf/docx/epub. Null for pasted text and URLs. */
  @Column({ type: 'text', name: 'file_url', nullable: true })
  fileUrl?: string | null;

  @Column({ type: 'text', name: 'file_name', nullable: true })
  fileName?: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'content_type',
    nullable: true,
  })
  contentType?: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes?: number | null;

  /**
   * The full extracted text, retained deliberately rather than discarded after chunking.
   *
   * Two things depend on it. Chunk `charStart`/`charEnd` index into THIS string, so a
   * citation resolves to an exact span. And re-chunking (a changed chunk size, a fixed
   * splitter) never has to re-parse the original PDF — which matters because re-parsing is
   * the slowest, most failure-prone step and the S3 object may since have been removed.
   *
   * Roughly 1 MB for a 300-page book; Postgres TOASTs it out of line without fuss.
   */
  @Column({ type: 'text', name: 'raw_text', default: '' })
  rawText!: string;

  /** Declared by the admin or detected at extraction. BCP-47. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  language?: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  /**
   * Available to every organisation, present and future.
   *
   * Default FALSE, matching `tracks`/`cases`/`scenario_paths`, so a document created by a caller
   * that forgot the field reaches nobody rather than everybody: an unreachable document is a
   * visible bug an admin can fix with one click, where an over-shared one is invisible. The
   * migration that added this column set every document that already existed to `true`, because
   * the corpus WAS global at that point — that is what the old rows mean, not a guess.
   *
   * `isGlobal = false` with no rows in `kb_document_tenants` is a real, savable state that means
   * the document is indexed and retrievable by nobody. The corpus table names it rather than
   * hiding it, since it is otherwise indistinguishable from a document that simply never gets
   * asked about.
   */
  @Index('idx_kb_documents_is_global')
  @Column({ type: 'boolean', name: 'is_global', default: false })
  isGlobal!: boolean;

  @Index('idx_kb_documents_status')
  @Column({
    type: 'varchar',
    length: 16,
    default: KbDocumentStatus.PENDING,
  })
  status!: KbDocumentStatus;

  /**
   * The admin-visible reason for the current status, verbatim.
   *
   * Surfaced in the corpus table rather than logged, because "Processing failed" makes an
   * encrypted PDF indistinguishable from an oversized one, and the admin is the person who
   * can actually fix either.
   */
  @Column({ type: 'text', name: 'status_message', nullable: true })
  statusMessage?: string | null;

  @Column({ type: 'int', name: 'chunk_count', default: 0 })
  chunkCount!: number;

  /**
   * How many chunks ally-ai has confirmed. Tracked separately from chunkCount so a partly
   * indexed document shows real progress instead of flipping from 0 to done, and so a
   * resume retries only what is missing.
   */
  @Column({ type: 'int', name: 'indexed_chunk_count', default: 0 })
  indexedChunkCount!: number;

  /** SHA-256 of rawText. An edit that does not change it skips re-indexing entirely. */
  @Column({ type: 'varchar', length: 64, name: 'content_hash', default: '' })
  contentHash!: string;

  /**
   * Bumped on every re-chunk. Chunk rows are never updated in place: a new version writes
   * new rows under new UUIDs and the old generation's vectors are deleted. That is what
   * makes a chunk's text immutable for a given (document, version, index), so there is no
   * staleness window between Postgres and the vector index to reason about.
   */
  @Column({ type: 'int', name: 'chunk_version', default: 1 })
  chunkVersion!: number;

  /**
   * Archived documents are excluded from retrieval (their vectors are deleted) but their
   * rows and chunks stay, so citations already recorded in the conversation log still
   * resolve to the passage that was actually quoted. Archiving is reversible; deleting
   * would orphan history.
   */
  @Column({ type: 'timestamp', name: 'archived_at', nullable: true })
  archivedAt?: Date | null;

  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int', nullable: true })
  updatedBy?: number | null;
}
