import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AiService } from 'src/ai/service/ai.service';
import { KnowledgeChunkItemRequest } from 'src/ai/dto/knowledge.dto';
import { S3Service } from 'src/aws/service/s3.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  KB_INDEX_BATCH_SIZE,
  KB_MAX_CHUNKS_PER_DOCUMENT,
} from '../constants/knowledge-base.constants';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbChunkUploadStatus,
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';
import { ExtractedDocument, extractDocument } from '../extractor';
import { KbDocumentChunkRepository } from '../repository/kb-document-chunk.repository';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { Chunk, chunkDocument } from '../util/chunker';

/**
 * Runs one document from raw source to searchable passages.
 *
 * Walks `extracting → chunking → indexing → indexed`, persisting the stage on the row as it goes so
 * the admin table shows real progress rather than flipping from pending to done. Every failure sets
 * `status=failed` with an admin-readable `statusMessage`, because "Processing failed" makes an
 * encrypted PDF indistinguishable from an oversized one and the admin is the only person who can
 * fix either.
 */
@Injectable()
export class KbIngestService {
  private readonly logger = LoggerService.getInstance(KbIngestService.name);

  constructor(
    private readonly documentRepository: KbDocumentRepository,
    private readonly chunkRepository: KbDocumentChunkRepository,
    private readonly aiService: AiService,
    private readonly s3Service: S3Service,
  ) {}

  static hash(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }

  /**
   * Full ingest: extract, chunk, index.
   *
   * `reindex` skips extraction and re-chunks the retained rawText instead. That is the whole reason
   * rawText is kept: re-parsing a 300-page PDF to change a chunk size would be slow, could fail
   * differently the second time, and needs an S3 object that may no longer exist.
   */
  async run(documentId: string, action: 'ingest' | 'reindex'): Promise<void> {
    const document = await this.documentRepository.findOne({
      where: { id: documentId },
    });
    if (!document) {
      this.logger.warn(
        `Ingest skipped — document ${documentId} no longer exists`,
      );
      return;
    }
    if (document.archivedAt) {
      this.logger.info(`Ingest skipped — document ${documentId} is archived`);
      return;
    }

    try {
      // A reindex re-chunks the retained rawText and never re-parses the original file. It
      // therefore has no page or section spans — those exist only in an extraction result — so a
      // reindexed PDF loses its page-level citations and falls back to document-level ones. That
      // is the deliberate cost of not depending on an S3 object that may no longer be there;
      // re-uploading the file restores page numbers.
      const extracted: ExtractedDocument =
        action === 'reindex' && document.rawText
          ? { text: document.rawText, pages: [], sections: [] }
          : await this.extract(document);

      await this.chunkAndIndex(document, extracted, action);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown ingest failure';
      this.logger.error(`Ingest failed for document ${documentId}: ${message}`);
      await this.documentRepository.update(
        { id: documentId },
        { status: KbDocumentStatus.FAILED, statusMessage: message },
      );
      // Swallowed rather than rethrown: the failure is already recorded where the admin will see
      // it, and rethrowing would make SQS redeliver a document that will fail identically every
      // time until someone fixes the file. The Retry action re-queues it deliberately.
    }
  }

  /**
   * Extract text, persist it, and hand the whole result to the caller.
   *
   * The page and section spans are returned rather than persisted: they are only meaningful against
   * this exact rawText, so storing them separately would create a second thing that can drift out
   * of sync with the text their offsets refer to. Chunking consumes them in the same pass.
   */
  private async extract(document: KbDocument): Promise<ExtractedDocument> {
    await this.documentRepository.update(
      { id: document.id },
      { status: KbDocumentStatus.EXTRACTING, statusMessage: null },
    );

    const buffer = await this.loadSourceBuffer(document);
    const extracted = await extractDocument({
      sourceType: document.sourceType,
      buffer,
      text: document.rawText || undefined,
      sourceUrl: document.sourceUrl ?? undefined,
    });

    await this.documentRepository.update(
      { id: document.id },
      {
        rawText: extracted.text,
        contentHash: KbIngestService.hash(extracted.text),
        // Only fill in a title or language the admin left blank — never overwrite what they typed.
        ...(document.title.trim()
          ? {}
          : { title: extracted.title ?? 'Untitled' }),
        ...(document.language ? {} : { language: extracted.language ?? null }),
      },
    );

    return extracted;
  }

  private async loadSourceBuffer(
    document: KbDocument,
  ): Promise<Buffer | undefined> {
    const needsFile = [
      KbDocumentSourceType.PDF,
      KbDocumentSourceType.DOCX,
      KbDocumentSourceType.EPUB,
    ].includes(document.sourceType);
    if (!needsFile) return undefined;

    if (!document.fileUrl) {
      throw new Error(
        'The uploaded file is missing from this document — upload it again.',
      );
    }
    const parsed = this.s3Service.parseS3Url(document.fileUrl);
    if (!parsed) {
      throw new Error(
        `The stored file URL could not be parsed, so the file cannot be read back: ${document.fileUrl}`,
      );
    }
    return this.s3Service.getObjectBuffer(parsed);
  }

  /** Chunk the text and push every chunk to the vector index. */
  private async chunkAndIndex(
    document: KbDocument,
    extracted: ExtractedDocument,
    action: 'ingest' | 'reindex',
  ): Promise<void> {
    await this.documentRepository.update(
      { id: document.id },
      { status: KbDocumentStatus.CHUNKING },
    );

    const chunks = chunkDocument(extracted);

    if (!chunks.length) {
      throw new Error(
        'This document produced no chunks — it appears to contain no readable prose.',
      );
    }
    if (chunks.length > KB_MAX_CHUNKS_PER_DOCUMENT) {
      // Explicit failure naming the real numbers, never a silent truncation: a truncated document
      // reads as fully indexed while most of it is unsearchable.
      throw new Error(
        `This document produced ${chunks.length.toLocaleString()} chunks, over the ` +
          `${KB_MAX_CHUNKS_PER_DOCUMENT.toLocaleString()} limit. Split it into parts and ` +
          `upload them separately.`,
      );
    }

    // A re-chunk becomes a NEW version. Chunk rows are never edited in place, so the text behind a
    // citation cannot change under a conversation that already quoted it.
    const chunkVersion =
      action === 'reindex' ? document.chunkVersion + 1 : document.chunkVersion;

    const rows = await this.persistChunks(document, chunks, chunkVersion);

    await this.documentRepository.update(
      { id: document.id },
      {
        status: KbDocumentStatus.INDEXING,
        chunkCount: rows.length,
        indexedChunkCount: 0,
        chunkVersion,
      },
    );

    // Delete the OLD generation's vectors before writing the new ones.
    //
    // This ordering is deliberate and it accepts a brief window where the document is not
    // retrievable. The alternative — write new, then delete old — has a window where BOTH
    // generations are retrievable, and a duplicated passage produces a confidently wrong citation
    // to text the document no longer contains. A missing passage merely produces an honest decline.
    await this.deleteVectors(document.id);

    const indexed = await this.indexChunks(document, rows, chunkVersion);

    if (action === 'reindex') {
      await this.chunkRepository.deleteOtherVersions(document.id, chunkVersion);
    }

    const failed = rows.length - indexed;
    await this.documentRepository.update(
      { id: document.id },
      {
        indexedChunkCount: indexed,
        status: failed ? KbDocumentStatus.FAILED : KbDocumentStatus.INDEXED,
        statusMessage: failed
          ? `${indexed} of ${rows.length} passages indexed; ${failed} failed. ` +
            `Use Retry to index the rest.`
          : null,
      },
    );

    this.logger.info(
      `Document ${document.id} indexed ${indexed}/${rows.length} chunk(s) at version ${chunkVersion}`,
    );
  }

  private async persistChunks(
    document: KbDocument,
    chunks: Chunk[],
    chunkVersion: number,
  ) {
    const entities = chunks.map((chunk) =>
      this.chunkRepository.create({
        documentId: document.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        sectionPath: chunk.sectionPath,
        tokenCount: chunk.tokenCount,
        textHash: KbIngestService.hash(chunk.text),
        uploadStatus: KbChunkUploadStatus.PENDING,
        chunkVersion,
      }),
    );
    // Chunked save: a single insert of 3000 rows can exceed the driver's parameter limit.
    const saved = [];
    for (let i = 0; i < entities.length; i += 500) {
      saved.push(
        ...(await this.chunkRepository.save(entities.slice(i, i + 500))),
      );
    }
    return saved;
  }

  private async deleteVectors(documentId: string): Promise<void> {
    try {
      await this.aiService.deleteKnowledgeChunksByDocument(documentId);
    } catch (error) {
      // Surfaced, not swallowed: proceeding to write the new generation while the old one may
      // still be live is exactly the double-retrieval case the ordering above exists to avoid.
      throw new Error(
        `Could not clear the previous version from the search index, so indexing was stopped ` +
          `to avoid serving two versions of the same passage: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
      );
    }
  }

  /** Push chunks in batches, recording per-chunk outcomes. Returns how many landed. */
  private async indexChunks(
    document: KbDocument,
    rows: { id: string; [key: string]: any }[],
    chunkVersion: number,
  ): Promise<number> {
    for (let i = 0; i < rows.length; i += KB_INDEX_BATCH_SIZE) {
      const batch = rows.slice(i, i + KB_INDEX_BATCH_SIZE);
      const items: KnowledgeChunkItemRequest[] = batch.map((row) => ({
        chunk_id: row.id,
        document_id: document.id,
        document_title: document.title,
        chunk_index: row.chunkIndex,
        text: row.text,
        char_start: row.charStart,
        char_end: row.charEnd,
        page_from: row.pageFrom,
        page_to: row.pageTo,
        section_path: row.sectionPath ?? '',
        source_url: document.sourceUrl ?? '',
        language: document.language ?? '',
        tags: document.tags ?? [],
        token_count: row.tokenCount,
      }));

      try {
        const response = await this.aiService.bulkUpsertKnowledgeChunks({
          items,
        });
        await this.chunkRepository.markIndexed(
          response.succeeded.map((s) => s.chunk_id),
        );
        if (response.failed.length) {
          await this.chunkRepository.markFailed(
            response.failed.map((f) => ({
              chunkId: f.chunk_id,
              error: f.error,
            })),
          );
        }
      } catch (error) {
        // A whole-batch transport failure is recorded per chunk so the retry path knows exactly
        // which passages are still missing rather than starting the document over.
        const message =
          error instanceof Error ? error.message : 'unknown indexing error';
        await this.chunkRepository.markFailed(
          batch.map((row) => ({ chunkId: row.id, error: message })),
        );
        this.logger.error(
          `Indexing batch failed for document ${document.id}: ${message}`,
        );
      }

      // Progress is written per batch, not at the end, so the admin sees 128/500 while it runs.
      const indexedSoFar = await this.chunkRepository.countIndexed(
        document.id,
        chunkVersion,
      );
      await this.documentRepository.update(
        { id: document.id },
        { indexedChunkCount: indexedSoFar },
      );
    }

    return this.chunkRepository.countIndexed(document.id, chunkVersion);
  }
}
