import { Injectable } from '@nestjs/common';
import { DataSource, In, Not, Repository } from 'typeorm';
import { KbDocumentChunk } from '../entity/kb-document-chunk.entity';
import { KbChunkUploadStatus } from '../enum/knowledge-base.enum';

@Injectable()
export class KbDocumentChunkRepository extends Repository<KbDocumentChunk> {
  constructor(private readonly dataSource: DataSource) {
    super(KbDocumentChunk, dataSource.createEntityManager());
  }

  /** One page of a document's chunks at the current version, in reading order. */
  async listForDocument(
    documentId: string,
    chunkVersion: number,
    options: { limit?: number; offset?: number } = {},
  ): Promise<{ chunks: KbDocumentChunk[]; count: number }> {
    const [chunks, count] = await this.findAndCount({
      where: { documentId, chunkVersion },
      order: { chunkIndex: 'ASC' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
    return { chunks, count };
  }

  /**
   * Chunks still needing to be pushed to the vector index.
   *
   * Drives resume: after a partial batch the ingest job asks for what is left rather than
   * re-indexing everything, which is the whole point of tracking uploadStatus per chunk.
   */
  async findPendingForDocument(
    documentId: string,
    chunkVersion: number,
  ): Promise<KbDocumentChunk[]> {
    return this.find({
      where: {
        documentId,
        chunkVersion,
        uploadStatus: Not(KbChunkUploadStatus.SUCCESS),
      },
      order: { chunkIndex: 'ASC' },
    });
  }

  async markIndexed(chunkIds: string[]): Promise<void> {
    if (!chunkIds.length) return;
    await this.update(
      { id: In(chunkIds) },
      { uploadStatus: KbChunkUploadStatus.SUCCESS, uploadError: null },
    );
  }

  /**
   * Record per-chunk failures with their reasons.
   *
   * Updated one at a time because each carries its own error text, and an admin diagnosing "why is
   * this document stuck at 384 of 500" needs the actual reason per chunk, not a shared one.
   */
  async markFailed(
    failures: { chunkId: string; error: string }[],
  ): Promise<void> {
    for (const { chunkId, error } of failures) {
      await this.update(
        { id: chunkId },
        {
          uploadStatus: KbChunkUploadStatus.FAILED,
          // Truncated: an upstream error can be a whole stack trace, and this column is read in a
          // table cell.
          uploadError: error.slice(0, 500),
        },
      );
    }
  }

  async countIndexed(
    documentId: string,
    chunkVersion: number,
  ): Promise<number> {
    return this.count({
      where: {
        documentId,
        chunkVersion,
        uploadStatus: KbChunkUploadStatus.SUCCESS,
      },
    });
  }

  /**
   * Delete every chunk row of a document EXCEPT the given version.
   *
   * Called after a re-chunk has finished, so the previous generation's rows disappear only once
   * their replacements exist. Deleting them earlier would break any citation recorded against the
   * old generation before the new vectors were live.
   */
  async deleteOtherVersions(
    documentId: string,
    keepVersion: number,
  ): Promise<number> {
    const result = await this.createQueryBuilder()
      .delete()
      .where('document_id = :documentId', { documentId })
      .andWhere('chunk_version != :keepVersion', { keepVersion })
      .execute();
    return result.affected ?? 0;
  }
}
