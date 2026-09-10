import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tenant } from 'src/tenant/entity/tenant.entity';
import { AiService } from 'src/ai/service/ai.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { ConfigurationException } from 'src/exception/configuration.exception';
import {
  KB_DOCUMENT_S3_PREFIX,
  KB_MAX_FILE_SIZE_BYTES,
} from '../constants/knowledge-base.constants';
import {
  CreateKbDocumentDto,
  CreateKbUploadUrlDto,
  GetKbDocumentsQueryDto,
  KbDocumentResponseDto,
  KbSearchDto,
  ReplaceKbDocumentContentDto,
  UpdateKbDocumentAudienceDto,
  UpdateKbDocumentDto,
} from '../dto/knowledge-base.dto';
import { KbDocument } from '../entity/kb-document.entity';
import {
  KbDocumentSourceType,
  KbDocumentStatus,
} from '../enum/knowledge-base.enum';
import { KbIngestProducer } from '../producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from '../repository/kb-document-chunk.repository';
import { KbDocumentTenantRepository } from '../repository/kb-document-tenant.repository';
import { KbDocumentRepository } from '../repository/kb-document.repository';
import { KbIngestService } from './kb-ingest.service';

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
    private readonly documentTenantRepository: KbDocumentTenantRepository,
    private readonly ingestProducer: KbIngestProducer,
    private readonly aiService: AiService,
    private readonly s3Service: S3Service,
    private readonly configService: AppConfigService,
    // The Tenant entity's plain repository rather than TenantsRepository: this needs one
    // existence check, and importing the tenant module for it would couple two modules that
    // otherwise share nothing (and this codebase has a live circular-import DI trap).
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
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

  private toResponse(
    entity: KbDocument,
    tenantIds: string[] = [],
  ): KbDocumentResponseDto {
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
      isGlobal: entity.isGlobal,
      // Empty for a global document even when rows exist. The rows are not consulted while
      // isGlobal is true, and returning them would invite a UI that renders a document
      // available to everyone as if it were restricted to three organisations.
      tenantIds: entity.isGlobal ? [] : tenantIds,
      isArchived: entity.archivedAt != null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * A response with the document's organisations loaded.
   *
   * The single-document path. `list` loads a page's worth in one query instead — see there.
   */
  private async respond(entity: KbDocument): Promise<KbDocumentResponseDto> {
    if (entity.isGlobal) return this.toResponse(entity);
    const tenantIds = await this.documentTenantRepository.tenantIdsForDocument(
      entity.id,
    );
    return this.toResponse(entity, tenantIds);
  }

  /**
   * Reject organisation ids that do not exist, before anything is written.
   *
   * Checked rather than trusted because the ids reach a Weaviate filter, where a nonexistent one
   * is indistinguishable from a real one that simply never matches: the document would look
   * correctly targeted in the admin UI and be retrievable by nobody.
   */
  private async assertTenantsExist(tenantIds: string[]): Promise<void> {
    if (!tenantIds.length) return;
    const unique = [...new Set(tenantIds)];
    const found = await this.tenantRepository.count({
      where: { id: In(unique) },
    });
    if (found !== unique.length) {
      throw new BadRequestException(
        'One or more of those organisations no longer exists. Reload the page and pick again.',
      );
    }
  }

  /**
   * Push a document's audience onto its indexed chunks.
   *
   * Separate from the Postgres write, and deliberately AFTER it: Postgres is the system of record,
   * so a vector index that lags is recoverable (a reindex re-sends the audience with the chunks)
   * while a vector index that leads is not.
   *
   * Failures are RETHROWN as a 500 rather than logged. The half-applied state is the one that
   * matters: passages of a document still answering for an organisation an admin just removed,
   * on a screen that said the change was saved.
   */
  private async syncAudienceToIndex(
    document: KbDocument,
    tenantIds: string[],
  ): Promise<void> {
    try {
      await this.aiService.setKnowledgeChunkAudience(document.id, {
        is_global: document.isGlobal,
        tenant_ids: document.isGlobal ? [] : tenantIds,
      });
    } catch (error) {
      throw new InternalServerErrorException(
        `The organisations were saved, but the search index could not be updated, so ` +
          `retrieval may still use the previous audience. Use Retry on the document to ` +
          `re-index it: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
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

    const isGlobal = dto.isGlobal ?? false;
    const tenantIds = isGlobal ? [] : (dto.tenantIds ?? []);
    await this.assertTenantsExist(tenantIds);

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
      isGlobal,
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
    // Written BEFORE the ingest is queued, so the consumer that indexes the chunks reads the
    // final audience and stamps it onto every one of them. Queued first, the first generation of
    // chunks would carry an empty audience and the document would be retrievable by nobody until
    // something happened to re-index it.
    if (tenantIds.length) {
      await this.documentTenantRepository.replaceForDocument(
        saved.id,
        tenantIds,
      );
    }

    await this.ingestProducer.enqueue({
      documentId: saved.id,
      action: 'ingest',
    });

    this.logger.info(`Knowledge-base document created: ${saved.id}`);
    return this.toResponse(saved, tenantIds);
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
      limit: dto.limit,
      offset: dto.offset,
      search: dto.search,
      status: dto.status,
      sourceType: dto.sourceType,
      tags: dto.tags,
      tenantId: dto.tenantId,
      includeArchived: dto.includeArchived,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });

    // One query for the page's organisations rather than one per row: the corpus table renders
    // that cell on every line.
    const byDocument = await this.documentTenantRepository.tenantIdsByDocument(
      documents.filter((d) => !d.isGlobal).map((d) => d.id),
    );

    return {
      documents: documents.map((d) =>
        this.toResponse(d, byDocument.get(d.id) ?? []),
      ),
      count,
    };
  }

  async get(id: string): Promise<KbDocumentResponseDto> {
    return this.respond(await this.findOrFail(id));
  }

  /**
   * Retarget a document at one, some or all organisations.
   *
   * Deliberately NOT part of PATCH /documents/:id, which documents itself as metadata-only and
   * "never triggers a re-index". This one does touch the index — it rewrites the audience on
   * every chunk — so it is its own endpoint rather than a field that quietly behaves differently
   * from its neighbours.
   *
   * Order: validate, write Postgres, then push to the index. An archived document is allowed
   * through: archiving deleted its vectors, so the sweep updates nothing, and the audience is
   * waiting correctly for whenever it is unarchived and re-indexed.
   */
  async setAudience(
    id: string,
    dto: UpdateKbDocumentAudienceDto,
  ): Promise<KbDocumentResponseDto> {
    const document = await this.findOrFail(id);
    const userId = this.currentUserId();

    const tenantIds = dto.isGlobal ? [] : (dto.tenantIds ?? []);
    await this.assertTenantsExist(tenantIds);

    const { added, removed } =
      await this.documentTenantRepository.replaceForDocument(id, tenantIds);
    const globalChanged = document.isGlobal !== dto.isGlobal;

    if (globalChanged) {
      await this.documentRepository.update(
        { id },
        { isGlobal: dto.isGlobal, updatedBy: userId },
      );
    }

    const updated = { ...document, isGlobal: dto.isGlobal } as KbDocument;

    // Nothing changed, so nothing is swept. An admin who opens the panel and saves without
    // editing should not trigger hundreds of vector writes over a 300-page book.
    if (!globalChanged && !added.length && !removed.length) {
      return this.toResponse(updated, tenantIds);
    }

    await this.syncAudienceToIndex(updated, tenantIds);

    this.logger.info(
      `Document ${id} retargeted: isGlobal=${dto.isGlobal}, ` +
        `+${added.length}/-${removed.length} organisation(s)`,
    );
    return this.toResponse(updated, tenantIds);
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

    return this.respond({ ...document, ...dto } as KbDocument);
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
      return this.respond(document);
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
    if (document.archivedAt) return this.respond(document);

    try {
      await this.aiService.deleteKnowledgeChunksByDocument(id);
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
    if (!document.archivedAt) return this.respond(document);

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

  /** Retrieval preview: exactly what the agent would see, with no generation cost. */
  async search(dto: KbSearchDto) {
    const response = await this.aiService.searchKnowledgeChunks({
      query: dto.query,
      limit: dto.limit ?? 8,
      min_similarity: dto.minSimilarity ?? 0.35,
      // With no organisation named this previews the WHOLE corpus, which is what a console
      // whose job is "show me what is indexed" should do. Naming one previews what a worker
      // from that organisation would actually retrieve — the question an admin asks when a
      // customer reports a gap.
      audience: dto.tenantId
        ? { tenant_id: dto.tenantId, include_global: true }
        : { unrestricted: true },
    });
    return { passages: response.passages };
  }

  async stats() {
    const [byStatus, totals] = await Promise.all([
      this.documentRepository.countsByStatus(),
      this.documentRepository.totals(),
    ]);
    return {
      byStatus,
      totalChunks: totals.chunkCount,
      indexedChunks: totals.indexedChunkCount,
    };
  }
}
