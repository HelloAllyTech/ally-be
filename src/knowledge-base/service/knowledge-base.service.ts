import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AiService } from 'src/ai/service/ai.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ConfigurationException } from 'src/exception/configuration.exception';
import {
  KB_DOCUMENT_S3_PREFIX,
  KB_MAX_FILE_SIZE_BYTES,
  KB_MAX_PASSAGES_PER_DOCUMENT,
  KB_MIN_SIMILARITY_DEFAULT,
} from '../constants/knowledge-base.constants';
import {
  CreateKbDocumentDto,
  CreateKbUploadUrlDto,
  GetKbDocumentsQueryDto,
  GetKbStatsQueryDto,
  KbDocumentResponseDto,
  KbSearchDto,
  ReplaceKbDocumentContentDto,
  UpdateKbDocumentDto,
} from '../dto/knowledge-base.dto';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbCorpus,
  KbDocumentSourceType,
  KbDocumentStatus,
  KbRetrievalConsumer,
  KbRetrievalPass,
} from '../enum/knowledge-base.enum';

/**
 * Who is retrieving, and on whose behalf. Not part of the DTO because none of it comes from
 * the request body — the consumer is decided by which code path called, and letting a client
 * assert it would let the admin preview file its experiments as agent traffic.
 */
export interface RetrievalContext {
  consumer?: KbRetrievalConsumer;
  sessionId?: string | null;
  userId?: number | null;
}
import { KbIngestProducer } from '../producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from '../repository/kb-document-chunk.repository';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { KbIngestService } from './kb-ingest.service';
import {
  concatDistinct,
  shapePassages,
  shapeWithDecisions,
} from '../util/retrieval';
import {
  KbRetrievalRepository,
  RetrievalPassageRecord,
} from '../repository/kb-retrieval.repository';

/** MIME types accepted for an uploaded corpus document, mapped to their source type. */
const UPLOAD_CONTENT_TYPES: Record<string, KbDocumentSourceType> = {
  'application/pdf': KbDocumentSourceType.PDF,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    KbDocumentSourceType.DOCX,
  'application/epub+zip': KbDocumentSourceType.EPUB,
};

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = LoggerService.getInstance(
    KnowledgeBaseService.name,
  );

  constructor(
    private readonly documentRepository: KbDocumentRepository,
    private readonly chunkRepository: KbDocumentChunkRepository,
    private readonly ingestProducer: KbIngestProducer,
    private readonly aiService: AiService,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
    private readonly retrievalRepository: KbRetrievalRepository,
  ) {}

  private getBucket(): string {
    const bucket = this.configService.s3.assetsBucket;
    if (!bucket) {
      // Detail is logged, not returned — see ConfigurationException.
      throw new ConfigurationException(
        'S3 bucket name for assetsBucket (S3_ASSETS_BUCKET) is not defined; ' +
          'knowledge-base uploads cannot be stored.',
      );
    }
    return bucket;
  }

  private currentUserId(): number {
    const userId = ExecutionManager.getUserId();
    if (!userId) throw new BadRequestException('unauthorized access');
    return Number(userId);
  }

  private toResponse(entity: KbDocument): KbDocumentResponseDto {
    return {
      id: entity.id,
      title: entity.title,
      sourceType: entity.sourceType,
      sourceUrl: entity.sourceUrl ?? null,
      fileName: entity.fileName ?? null,
      contentType: entity.contentType ?? null,
      sizeBytes:
        entity.sizeBytes === null || entity.sizeBytes === undefined
          ? null
          : Number(entity.sizeBytes),
      language: entity.language ?? null,
      tags: entity.tags ?? [],
      status: entity.status,
      statusMessage: entity.statusMessage ?? null,
      chunkCount: entity.chunkCount,
      indexedChunkCount: entity.indexedChunkCount,
      isArchived: entity.archivedAt != null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Presigned PUT for an uploaded document.
   *
   * Presigned rather than a multipart POST through this API: `express.json({limit:'1mb'})` is
   * applied globally in main.ts, so a 40 MB upload would be rejected long before it reached a
   * controller. The browser PUTs straight to S3 and hands the resulting URL back on create.
   */
  async createUploadUrl(dto: CreateKbUploadUrlDto) {
    const bucket = this.getBucket();
    if (!UPLOAD_CONTENT_TYPES[dto.contentType]) {
      throw new BadRequestException(
        'Only PDF, Word (.docx) and EPUB files can be uploaded. Paste text or use a URL for ' +
          'anything else.',
      );
    }
    this.currentUserId();

    const { presignedUrl, imageUrl } =
      await this.s3Service.getPresignedUrlForImageUpload(
        bucket,
        KB_DOCUMENT_S3_PREFIX,
        dto.fileName,
        dto.fileSize,
        dto.contentType,
        KB_MAX_FILE_SIZE_BYTES,
      );

    return { presignedUrl, fileUrl: imageUrl };
  }

  /**
   * Create a document row and queue its ingest.
   *
   * Returns immediately at `pending`. Ingest is minutes of work for a large PDF, so doing it inline
   * would hold the admin's request open and lose the upload on any transient failure.
   */
  async create(dto: CreateKbDocumentDto): Promise<KbDocumentResponseDto> {
    const userId = this.currentUserId();
    this.validateSource(dto);

    const document = this.documentRepository.create({
      title: dto.title.trim(),
      sourceType: dto.sourceType,
      sourceUrl: dto.sourceUrl ?? null,
      fileUrl: dto.fileUrl ?? null,
      fileName: dto.fileName ?? null,
      contentType: dto.contentType ?? null,
      sizeBytes: dto.sizeBytes ?? null,
      language: dto.language ?? null,
      tags: dto.tags ?? [],
      // Pasted text is stored up front so the row is self-sufficient; the extractor still runs over
      // it to derive sections, and every other source type fills this in during ingest.
      rawText:
        dto.sourceType === KbDocumentSourceType.PASTE ? (dto.text ?? '') : '',
      contentHash: '',
      status: KbDocumentStatus.PENDING,
      chunkVersion: 1,
      createdBy: userId,
    });

    const saved = await this.documentRepository.save(document);
    await this.ingestProducer.enqueue({
      documentId: saved.id,
      action: 'ingest',
    });

    this.logger.info(`Knowledge-base document created: ${saved.id}`);
    return this.toResponse(saved);
  }

  private validateSource(dto: CreateKbDocumentDto): void {
    switch (dto.sourceType) {
      case KbDocumentSourceType.PASTE:
        if (!dto.text?.trim()) {
          throw new BadRequestException(
            'Pasted documents need some body text.',
          );
        }
        return;
      case KbDocumentSourceType.URL:
        if (!dto.sourceUrl?.trim()) {
          throw new BadRequestException('URL documents need a source URL.');
        }
        return;
      default: {
        if (!dto.fileUrl?.trim()) {
          throw new BadRequestException(
            'Upload the file first, then create the document with the returned fileUrl.',
          );
        }
        const expected = dto.contentType
          ? UPLOAD_CONTENT_TYPES[dto.contentType]
          : undefined;
        if (expected && expected !== dto.sourceType) {
          // Catching this here rather than at extraction time means the admin is told at the point
          // they can still fix it, instead of watching the document fail a minute later.
          throw new BadRequestException(
            `The uploaded file is a ${expected} but the document was created as a ` +
              `${dto.sourceType}. Pick the matching type and try again.`,
          );
        }
      }
    }
  }

  async list(dto: GetKbDocumentsQueryDto) {
    const { documents, count } = await this.documentRepository.list({
      corpus: dto.corpus,
      limit: dto.limit,
      offset: dto.offset,
      search: dto.search,
      status: dto.status,
      sourceType: dto.sourceType,
      tags: dto.tags,
      includeArchived: dto.includeArchived,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });
    return { documents: documents.map((d) => this.toResponse(d)), count };
  }

  async get(id: string): Promise<KbDocumentResponseDto> {
    return this.toResponse(await this.findOrFail(id));
  }

  private async findOrFail(id: string): Promise<KbDocument> {
    const document = await this.documentRepository.findOne({ where: { id } });
    if (!document) {
      throw new NotFoundException(`Document ${id} was not found`);
    }
    return document;
  }

  /** Metadata only — never triggers a re-index. */
  async update(
    id: string,
    dto: UpdateKbDocumentDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    const userId = this.currentUserId();

    // A title change DOES leave the denormalised copy on already-indexed chunks stale. Accepted
    // deliberately: a citation naming a document's previous title still identifies the right
    // document, whereas re-indexing every chunk on a typo fix would be minutes of embedding work
    // for no retrieval gain. A Retry re-syncs it for anyone who cares.
    await this.documentRepository.update(
      { id },
      {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        updatedBy: userId,
      },
    );

    return this.toResponse({ ...document, ...dto } as KbDocument);
  }

  /**
   * Replace a pasted document's body and re-index if it actually changed.
   *
   * Only pasted text is editable in place. For a file-backed document the file IS the content, so
   * changing it means uploading a new one — editing the extracted text would silently disagree with
   * the PDF an admin can still download.
   */
  async replaceContent(
    id: string,
    dto: ReplaceKbDocumentContentDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.sourceType !== KbDocumentSourceType.PASTE) {
      throw new BadRequestException(
        'Only pasted documents can be edited here. Replace the file instead.',
      );
    }

    const text = dto.text.trim();
    const hash = KbIngestService.hash(text);
    if (hash === document.contentHash) {
      // Re-embedding hundreds of unchanged passages costs real money and time for no change in
      // behaviour, so an identical edit is a deliberate no-op.
      this.logger.info(
        `Content unchanged for document ${id}; skipping re-index`,
      );
      return this.toResponse(document);
    }

    await this.documentRepository.update(
      { id },
      {
        rawText: text,
        contentHash: hash,
        status: KbDocumentStatus.PENDING,
        statusMessage: null,
        updatedBy: this.currentUserId(),
      },
    );
    await this.ingestProducer.enqueue({ documentId: id, action: 'reindex' });

    return this.get(id);
  }

  /** Re-chunk and re-index from the retained rawText. Also the Retry action. */
  async reindex(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.archivedAt) {
      throw new BadRequestException(
        'Unarchive this document before re-indexing it.',
      );
    }

    await this.documentRepository.update(
      { id },
      { status: KbDocumentStatus.PENDING, statusMessage: null },
    );
    // 'ingest' rather than 'reindex' when there is no retained text yet — a document that failed
    // during its first extraction has nothing to re-chunk and needs the file parsed again.
    await this.ingestProducer.enqueue({
      documentId: id,
      action: document.rawText ? 'reindex' : 'ingest',
    });

    return this.get(id);
  }

  /**
   * Archive: drop the vectors, keep every row.
   *
   * The document stops being retrievable immediately, but its chunks stay in Postgres so citations
   * already recorded in the conversation log still resolve to the exact passage that was quoted.
   * Deleting the rows would orphan that history.
   */
  async archive(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (document.archivedAt) return this.toResponse(document);

    try {
      await this.aiService.deleteKnowledgeChunksByDocument(id, document.corpus);
    } catch (error) {
      // Reported, not swallowed: if the vectors survive, an "archived" document keeps answering
      // questions, which is precisely what the admin just asked it to stop doing.
      throw new InternalServerErrorException(
        `Archived nothing — the search index could not be updated: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    await this.documentRepository.update(
      { id },
      {
        archivedAt: new Date(),
        indexedChunkCount: 0,
        updatedBy: this.currentUserId(),
      },
    );
    return this.get(id);
  }

  /** Unarchive and re-index, since archiving deleted the vectors. */
  async unarchive(id: string): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    if (!document.archivedAt) return this.toResponse(document);

    await this.documentRepository.update(
      { id },
      {
        archivedAt: null,
        status: KbDocumentStatus.PENDING,
        statusMessage: null,
        updatedBy: this.currentUserId(),
      },
    );
    await this.ingestProducer.enqueue({
      documentId: id,
      action: document.rawText ? 'reindex' : 'ingest',
    });
    return this.get(id);
  }

  /**
   * Hard delete is refused.
   *
   * Deleting a document orphans every citation recorded against it, so the conversation log would
   * show answers whose sources cannot be resolved. Archive removes it from retrieval, which is what
   * "delete" is nearly always intended to mean here.
   */
  async remove(id: string): Promise<never> {
    await this.findOrFail(id);
    throw new ConflictException(
      'Documents are archived rather than deleted, so citations already recorded in the ' +
        'conversation log keep resolving. Archive it instead.',
    );
  }

  /** A document's chunks — literally what the bot can see. */
  async listChunks(
    id: string,
    options: { limit?: number; offset?: number } = {},
  ) {
    const document = await this.findOrFail(id);
    const { chunks, count } = await this.chunkRepository.listForDocument(
      id,
      document.chunkVersion,
      options,
    );
    return {
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        sectionPath: chunk.sectionPath ?? null,
        tokenCount: chunk.tokenCount,
        uploadStatus: chunk.uploadStatus,
        uploadError: chunk.uploadError ?? null,
      })),
      count,
    };
  }

  /** Resolve one chunk — how the conversation log turns a citation into real text. */
  async getChunk(chunkId: string) {
    const chunk = await this.chunkRepository.findOne({
      where: { id: chunkId },
    });
    if (!chunk) {
      throw new NotFoundException(`Chunk ${chunkId} was not found`);
    }
    const document = await this.documentRepository.findOne({
      where: { id: chunk.documentId },
      select: ['id', 'title', 'sourceUrl', 'sourceType'],
    });
    return {
      id: chunk.id,
      documentId: chunk.documentId,
      documentTitle: document?.title ?? '',
      sourceUrl: document?.sourceUrl ?? null,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      sectionPath: chunk.sectionPath ?? null,
    };
  }

  /**
   * The one retrieval path. Everything that grounds an answer on this corpus goes through
   * here — the WhatsApp answering agent, the character interview's search tool, and the admin
   * preview, which is the same call with no generation after it and is therefore worth
   * trusting as a preview.
   *
   * Three things happen that a bare vector search does not do:
   *
   * 1. Scope becomes the query. `retrievableIds` resolves ONE corpus's indexed, unarchived
   *    document ids in Postgres and they travel as ally-ai's `document_ids`. There is no
   *    "search everything" branch to fall into — an empty id set returns no passages rather
   *    than the whole shared collection, which is the failure this shape exists to make
   *    impossible.
   * 2. Curator hints boost rather than filter. Documents mapped to the asked-about
   *    `characterTopics` are searched first; the rest of the corpus tops the result up only
   *    if the first pass came back short. Mapped material therefore wins ties and near-ties
   *    without ever hiding the unmapped passage that turns out to matter.
   * 3. The ranking is shaped for reading, not scoring — see `shapePassages`.
   *
   * And every retrieval is recorded — see `KbRetrieval`. Not for an audit trail: the numbers
   * above (the floor most of all) were chosen by reasoning, and the first measurement showed
   * the floor was one paraphrase from rejecting a direct hit. The log is how they stop being
   * guesses.
   */
  async search(dto: KbSearchDto, context: RetrievalContext = {}) {
    const startedAt = Date.now();
    const { preferred, rest } = await this.documentRepository.retrievableIds({
      corpus: dto.corpus,
      tags: dto.tags,
      characterTopics: dto.characterTopics,
    });

    const limit = dto.limit ?? 8;
    const minSimilarity =
      dto.minSimilarity ?? KB_MIN_SIMILARITY_DEFAULT[dto.corpus];

    // Over-fetch, because shaping only ever removes passages: asking for `limit` and then
    // dropping the overlapping neighbours would quietly return three passages for a limit of
    // eight. Capped so a large limit cannot turn into an unbounded ally-ai query.
    const fetchLimit = Math.min(limit * 3, 50);

    const first = preferred.length
      ? await this.searchDocuments(
          dto.corpus,
          dto.query,
          preferred,
          fetchLimit,
          minSimilarity,
        )
      : [];

    // Only top up when shaping the first pass would not already fill the limit. Checked
    // against the SHAPED count rather than the raw one, or a first pass of eight
    // near-duplicates from one document would suppress the top-up and then collapse to two.
    const shapedFirst = shapePassages(first, {
      limit,
      perDocumentLimit: KB_MAX_PASSAGES_PER_DOCUMENT,
    });
    const topUpRan = shapedFirst.length < limit && rest.length > 0;
    const second = topUpRan
      ? await this.searchDocuments(
          dto.corpus,
          dto.query,
          rest,
          fetchLimit,
          minSimilarity,
        )
      : [];

    const candidates = concatDistinct(first, second);
    const { kept: passages, decisions } = shapeWithDecisions(candidates, {
      limit,
      perDocumentLimit: KB_MAX_PASSAGES_PER_DOCUMENT,
    });

    this.logger.info(
      `[KB_RETRIEVAL] corpus=${dto.corpus} preferred_docs=${preferred.length} ` +
        `rest_docs=${rest.length} topics=${(dto.characterTopics ?? []).join(',') || 'none'} ` +
        `min_similarity=${minSimilarity} raw=${first.length}+${second.length} ` +
        `returned=${passages.length}/${limit}`,
    );

    const firstPassChunkIds = new Set(first.map((p) => p.chunk_id));
    await this.recordRetrieval(
      {
        corpus: dto.corpus,
        consumer: context.consumer ?? KbRetrievalConsumer.ADMIN_PREVIEW,
        query: dto.query,
        characterTopics: dto.characterTopics ?? [],
        tags: dto.tags ?? [],
        minSimilarity,
        requestedLimit: limit,
        fetchLimit,
        preferredDocumentCount: preferred.length,
        restDocumentCount: rest.length,
        firstPassHits: first.length,
        // Null, not zero, when the top-up never ran — see KbRetrieval.secondPassHits.
        secondPassHits: topUpRan ? second.length : null,
        returnedCount: passages.length,
        latencyMs: Date.now() - startedAt,
        sessionId: context.sessionId ?? null,
        createdBy: context.userId ?? null,
      },
      decisions.map((decision, index) => ({
        chunkId: decision.passage.chunk_id,
        documentId: decision.passage.document_id,
        rank: index + 1,
        similarity: decision.passage.similarity,
        pass: firstPassChunkIds.has(decision.passage.chunk_id)
          ? KbRetrievalPass.PREFERRED
          : KbRetrievalPass.REST,
        outcome: decision.outcome,
      })),
    );

    return { passages };
  }

  /**
   * Persist one retrieval, and never let that failure become the caller's.
   *
   * Analytics are worth a table, not a retrieval. A full disk, a lock, a schema not yet
   * migrated on one instance — any of those would otherwise turn a working search into a 500
   * for an admin who asked a question, which is a straightforwardly worse product than having
   * no distribution to calibrate against. Warned rather than swallowed silently, so a log that
   * has quietly stopped writing is visible before someone builds a decision on the gap.
   */
  private async recordRetrieval(
    retrieval: Parameters<KbRetrievalRepository['record']>[0],
    passages: RetrievalPassageRecord[],
  ): Promise<void> {
    try {
      await this.retrievalRepository.record(retrieval, passages);
    } catch (error) {
      this.logger.warn(
        `[KB_RETRIEVAL] could not record the retrieval log: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async searchDocuments(
    corpus: KbCorpus,
    query: string,
    documentIds: string[],
    limit: number,
    minSimilarity: number,
  ) {
    const response = await this.aiService.searchKnowledgeChunks(
      {
        query,
        limit,
        min_similarity: minSimilarity,
        // Scopes WITHIN the corpus — the corpus itself is the collection. This is the
        // curator's topic boost: the mapped documents on the first pass, the rest on the
        // second.
        document_ids: documentIds,
      },
      corpus,
    );
    return response.passages ?? [];
  }

  async stats(dto: GetKbStatsQueryDto) {
    const [byStatus, totals] = await Promise.all([
      this.documentRepository.countsByStatus(dto.corpus),
      this.documentRepository.totals(dto.corpus),
    ]);
    return {
      byStatus,
      totalChunks: totals.chunkCount,
      indexedChunks: totals.indexedChunkCount,
    };
  }
}
