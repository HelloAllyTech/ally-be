import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { KbChunkUploadStatus } from '../enum/knowledge-base.enum';

/**
 * One retrievable passage of a corpus document.
 *
 * THIS ROW'S ID IS THE WEAVIATE OBJECT UUID. That is what makes a citation resolvable: the
 * bot's answer carries chunk ids, and the admin conversation log turns one back into the
 * exact words on the exact page by loading this row. It also makes every index write
 * idempotent by construction — no create-vs-update decision, no 409 path.
 *
 * Rows are immutable for a given (documentId, chunkVersion, chunkIndex). Re-chunking writes
 * a new version rather than editing, so the text behind a citation can never silently change
 * out from under a conversation that already quoted it.
 */
@Entity('kb_document_chunks')
@Index('uq_kb_document_chunks_doc_version_index', [
  'documentId',
  'chunkVersion',
  'chunkIndex',
])
export class KbDocumentChunk extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_kb_document_chunks_document')
  @Column({ type: 'uuid', name: 'document_id' })
  documentId!: string;

  /** Zero-based position within the document, and the ordering for display. */
  @Column({ type: 'int', name: 'chunk_index' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  text!: string;

  /** Offsets into kb_documents.rawText, so a citation resolves to an exact span. */
  @Column({ type: 'int', name: 'char_start', default: 0 })
  charStart!: number;

  @Column({ type: 'int', name: 'char_end', default: 0 })
  charEnd!: number;

  /**
   * Source page range, for citing "p. 44". Zero when the format has no pages (pasted text,
   * DOCX, EPUB, HTML) — zero rather than null because a citation renderer treats 0 as "not
   * paginated", and a nullable int here would invite `p. null` reaching a worker.
   */
  @Column({ type: 'int', name: 'page_from', default: 0 })
  pageFrom!: number;

  @Column({ type: 'int', name: 'page_to', default: 0 })
  pageTo!: number;

  /** Heading trail, e.g. 'Chapter 3 > Risk assessment'. Cited when there is no page. */
  @Column({ type: 'text', name: 'section_path', nullable: true })
  sectionPath?: string | null;

  /**
   * Tokens in `text`, counted at chunk time with gpt-tokenizer. Stored so ally-ai can budget
   * its prompt context without a tokeniser of its own — it has none, and adding one there
   * purely to re-count what was already counted here would be waste.
   */
  @Column({ type: 'int', name: 'token_count', default: 0 })
  tokenCount!: number;

  /** SHA-256 of `text`, mirrored into the vector index for stale-vector detection. */
  @Column({ type: 'varchar', length: 64, name: 'text_hash', default: '' })
  textHash!: string;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'upload_status',
    default: KbChunkUploadStatus.PENDING,
  })
  uploadStatus!: KbChunkUploadStatus;

  /** Why this chunk is not indexed, straight from ally-ai's per-chunk failure report. */
  @Column({ type: 'text', name: 'upload_error', nullable: true })
  uploadError?: string | null;

  @Column({ type: 'int', name: 'chunk_version', default: 1 })
  chunkVersion!: number;
}
