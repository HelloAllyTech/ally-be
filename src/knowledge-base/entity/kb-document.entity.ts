import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';

/**
 * One document in the WhatsApp Q&A bot's knowledge corpus, and the system of record for it.
 *
 * ally-ai's KnowledgeChunk collection is a DERIVED index over the chunks of these rows —
 * same ownership rule as reference documents and roadmap opportunities. Postgres is truth;
 * vectors can always be rebuilt from here.
 *
 * NO tenant. The bot is open to anyone with the number, so there is no tenant to scope by
 * and the corpus is deliberately global. A future private per-tenant corpus should be a new
 * collection rather than a filter added to the shared one — retrieval that forgets a filter
 * leaks, and an un-set filter is the easiest thing in the world to forget.
 */
@Entity('kb_documents')
export class KbDocument extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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
