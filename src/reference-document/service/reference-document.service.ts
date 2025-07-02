import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DocumentUploadStatus,
  ReferenceDocument,
} from '../../common/entities/reference-document.entity';
import {
  AddDocumentDto,
  SearchDocumentsDto,
  UpdateReferenceDocumentDto,
} from '../dto/reference-document.dto';
import { AiService } from '../../ai/service/ai.service';
import {
  SearchOperationFailedException,
  DocumentUpdateFailedException,
} from '../exception/reference-document.exception';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import { AddReferenceDocumentRequest } from '../../ai/dto/ai.request.dto';
import { OrganizationRequiredException } from '../../exception/custom.exception';
import { parseCsvBuffer } from '../../common/util/csv.util';
import { UserRole } from '../../common/constants/user.constants';

@Injectable()
export class ReferenceDocumentService {
  private readonly logger = LoggerService.getInstance(
    ReferenceDocumentService.name,
  );

  constructor(
    @InjectRepository(ReferenceDocument)
    private referenceDocumentRepository: Repository<ReferenceDocument>,
    private aiService: AiService,
  ) {}

  async addReferenceDocument(
    userId: number,
    dto: AddDocumentDto,
    role?: UserRole,
  ) {
    const organizationId =
      role === UserRole.ADMIN
        ? ExecutionManager.getTenantId()
        : dto.organisationId;

    if (!dto.isPublic && !organizationId) {
      throw new OrganizationRequiredException();
    }

    const document = this.referenceDocumentRepository.create({
      ...dto,
      createdBy: userId,
      uploadStatus: DocumentUploadStatus.PENDING,
      organizationId: dto.isPublic ? undefined : organizationId,
    });

    const savedDocument = await this.referenceDocumentRepository.save(document);

    const request: AddReferenceDocumentRequest = {
      document_id: savedDocument.id,
      heading: savedDocument.heading,
      content: savedDocument.content,
      category: savedDocument.category,
      tags: savedDocument.tags || [],
      tenant_id: dto.isPublic ? '' : organizationId || '',
    };

    try {
      const response = await this.aiService.addReferenceDocument(request);
      if (response.id) {
        savedDocument.uploadStatus = DocumentUploadStatus.SUCCESS;
      } else {
        savedDocument.uploadStatus = DocumentUploadStatus.FAILED;
      }
    } catch (error) {
      this.logger.error(
        `AI upload failed for document ID: ${savedDocument.id}`,
        error,
      );
      savedDocument.uploadStatus = DocumentUploadStatus.FAILED;
    }

    try {
      await this.referenceDocumentRepository.update(savedDocument.id, {
        uploadStatus: savedDocument.uploadStatus,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update document status for ID: ${savedDocument.id}`,
        error,
      );
      throw new DocumentUpdateFailedException(savedDocument.id, error);
    }

    return {
      id: savedDocument.id,
      uploadStatus: savedDocument.uploadStatus,
    };
  }

  async searchPublicDocuments(searchDto: SearchDocumentsDto) {
    const documents = await this.referenceDocumentRepository.find({
      select: ['id'],
      where: {
        isPublic: true,
        uploadStatus: DocumentUploadStatus.SUCCESS,
      },
    });

    return this.searchDocumentsByIds(
      searchDto,
      documents.map((d) => d.id),
      'public',
    );
  }

  async searchTenantDocuments(searchDto: SearchDocumentsDto) {
    const organizationId = ExecutionManager.getTenantId();
    if (!organizationId) {
      throw new OrganizationRequiredException();
    }

    const documents = await this.referenceDocumentRepository.find({
      select: ['id'],
      where: [
        { isPublic: true, uploadStatus: DocumentUploadStatus.SUCCESS },
        {
          organizationId,
          uploadStatus: DocumentUploadStatus.SUCCESS,
        },
      ],
    });

    return this.searchDocumentsByIds(
      searchDto,
      documents.map((d) => d.id),
      `organization ${organizationId}`,
    );
  }

  private async searchDocumentsByIds(
    searchDto: SearchDocumentsDto,
    availableIds: string[],
    contextLabel: string,
  ) {
    const documentIds = this.filterExcludedIds(
      availableIds,
      searchDto.excludedIds || [],
    );

    if (
      this.shouldSkipSearch(
        availableIds,
        documentIds,
        searchDto.query,
        contextLabel,
      )
    ) {
      return { documents: [], total: 0, categories: {} };
    }

    const request = this.buildSearchRequest(searchDto, documentIds);

    this.logger.info(
      `Searching ${contextLabel} documents with query "${searchDto.query}"`,
    );

    try {
      const response = await this.aiService.searchReferenceDocuments(request);

      return {
        documents: response.documents.map(this.mapDocument),
        total: response.total,
        limit: response.limit,
        categories: response.categories,
      };
    } catch (error) {
      this.logger.error(
        `Search failed for ${contextLabel} query "${searchDto.query}"`,
        {
          request,
          error: error.message || error,
          stack: error.stack,
        },
      );
      throw new SearchOperationFailedException(contextLabel, error);
    }
  }

  private filterExcludedIds(
    availableIds: string[],
    excludedIds: string[],
  ): string[] {
    if (!excludedIds.length) return availableIds;

    const excludedSet = new Set(excludedIds);
    return availableIds.filter((id) => !excludedSet.has(id));
  }

  private shouldSkipSearch(
    availableIds: string[],
    documentIds: string[],
    query: string,
    contextLabel: string,
  ): boolean {
    if (!availableIds.length) {
      this.logger.info(
        `No ${contextLabel} documents found for query "${query}"`,
      );
      return true;
    }

    if (!documentIds.length) {
      this.logger.info(
        `All ${contextLabel} documents excluded for query "${query}"`,
      );
      return true;
    }

    return false;
  }

  private buildSearchRequest(
    searchDto: SearchDocumentsDto,
    documentIds: string[],
  ) {
    return {
      query: searchDto.query,
      limit: Number(searchDto.limit) || 10,
      document_ids: documentIds,
      ...(searchDto.filters && { filters: searchDto.filters }),
      ...(searchDto.sortBy && { sort_by: searchDto.sortBy }),
      ...(searchDto.sortOrder && { sort_order: searchDto.sortOrder }),
    };
  }

  private mapDocument(doc: any) {
    return {
      id: doc.id,
      heading: doc.heading,
      content: doc.content,
      category: doc.category,
      tags: doc.tags || [],
      ...(doc.score !== undefined && { score: doc.score }),
    };
  }

  async updateReferenceDocument(id: string, dto: UpdateReferenceDocumentDto) {
    const document = await this.referenceDocumentRepository.findOneBy({ id });

    if (!document) {
      this.logger.error(`Reference document with ID ${id} not found`);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    let uploadStatus = DocumentUploadStatus.PENDING;
    await this.referenceDocumentRepository.update(id, {
      ...dto,
      uploadStatus,
      updatedAt: new Date(),
    });

    try {
      const response = await this.aiService.updateReferenceDocument(id, dto);
      if (response.id) {
        uploadStatus = DocumentUploadStatus.SUCCESS;
        await this.referenceDocumentRepository.update(id, {
          uploadStatus,
        });
      }
    } catch (error) {
      uploadStatus = DocumentUploadStatus.FAILED;
      await this.referenceDocumentRepository.update(id, {
        uploadStatus,
      });
    }

    return {
      id,
      uploadStatus,
    };
  }

  async bulkCreateFromCsv(userId: number, file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new Error('No file uploaded or file is empty');
    }

    const records = parseCsvBuffer(file.buffer);

    const results = await Promise.all(
      records.map((row: Record<string, string>) =>
        this.processCsvRow(userId, row),
      ),
    );

    const successCount = results.filter((r) => r.success).length;

    return {
      total: results.length,
      successCount,
      errorCount: results.length - successCount,
      results,
    };
  }

  private async processCsvRow(userId: number, row: Record<string, string>) {
    const dto: AddDocumentDto = {
      heading: row['Heading'],
      content: row['Description'],
      category: row['Content Category'],
      tags: row['Keywords']
        ? row['Keywords'].split(',').map((tag) => tag.trim())
        : [],
      isPublic: true,
    };

    try {
      const created = await this.addReferenceDocument(userId, dto);
      return { success: true, id: created.id };
    } catch (error: any) {
      return {
        success: false,
        error: error.message ?? 'Unknown error',
        row,
      };
    }
  }

  async getDistinctCategories() {
    const categories = await this.referenceDocumentRepository
      .createQueryBuilder('document')
      .select('document.category', 'category')
      .addSelect('COUNT(document.category)', 'count')
      .where('document.category IS NOT NULL')
      .groupBy('document.category')
      .orderBy('count', 'DESC')
      .getRawMany();

    return categories.map((cat) => cat.category);
  }

  async getReferenceDocument(id: string) {
    try {
      const aiDocument = await this.aiService.getReferenceDocument(id);
      return aiDocument;
    } catch (error) {
      this.logger.error(`Failed to get document from AI service: ${id}`, error);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }
  }

  async getPublicReferenceDocument(id: string) {
    const document = await this.referenceDocumentRepository.findOneBy({
      id,
      isPublic: true,
      uploadStatus: DocumentUploadStatus.SUCCESS,
    });

    if (!document) {
      this.logger.error(`Public reference document with ID ${id} not found`);
      throw new NotFoundException(
        `Public reference document with ID ${id} not found`,
      );
    }

    try {
      const aiDocument = await this.aiService.getReferenceDocument(id);
      return aiDocument;
    } catch (error) {
      this.logger.error(
        `Failed to get public document from AI service: ${id}`,
        error,
      );
      throw new NotFoundException(
        `Public reference document with ID ${id} not found`,
      );
    }
  }

  async getPrivateReferenceDocument(id: string) {
    const organizationId = ExecutionManager.getTenantId();
    if (!organizationId) {
      throw new OrganizationRequiredException();
    }

    const document = await this.referenceDocumentRepository.findOneBy({
      id,
      organizationId,
      uploadStatus: DocumentUploadStatus.SUCCESS,
    });

    if (!document) {
      this.logger.error(`Reference document with ID ${id} not found`);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    if (!document.isPublic && document.organizationId !== organizationId) {
      this.logger.error(
        `Access denied to reference document with ID ${id} for organization ${organizationId}`,
      );
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    try {
      const aiDocument = await this.aiService.getReferenceDocument(id);
      return aiDocument;
    } catch (error) {
      this.logger.error(
        `Failed to get private document from AI service: ${id}`,
        error,
      );
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }
  }

  async deleteReferenceDocument(id: string) {
    const document = await this.referenceDocumentRepository.findOneBy({ id });

    if (!document) {
      this.logger.error(`Reference document with ID ${id} not found`);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    try {
      await this.aiService.deleteReferenceDocument(id);
      await this.referenceDocumentRepository.delete(id);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to delete document: ${id}`, error);
      throw new Error(`Failed to delete reference document with ID ${id}`);
    }
  }

  async archiveReferenceDocument(id: string) {
    const document = await this.referenceDocumentRepository.findOneBy({ id });

    if (!document) {
      this.logger.error(`Reference document with ID ${id} not found`);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    if (document.isArchived) {
      this.logger.warn(`Reference document with ID ${id} is already archived`);
      return { success: true, message: 'Document is already archived' };
    }

    try {
      await this.referenceDocumentRepository.update(id, {
        isArchived: true,
        archivedAt: new Date(),
      });

      this.logger.info(
        `Reference document with ID ${id} archived successfully`,
      );
      return { success: true, message: 'Document archived successfully' };
    } catch (error) {
      this.logger.error(`Failed to archive document: ${id}`, error);
      throw new Error(`Failed to archive reference document with ID ${id}`);
    }
  }

  async unarchiveReferenceDocument(id: string) {
    const document = await this.referenceDocumentRepository.findOneBy({ id });

    if (!document) {
      this.logger.error(`Reference document with ID ${id} not found`);
      throw new NotFoundException(`Reference document with ID ${id} not found`);
    }

    if (!document.isArchived) {
      this.logger.warn(`Reference document with ID ${id} is not archived`);
      return { success: true, message: 'Document is not archived' };
    }

    try {
      await this.referenceDocumentRepository.update(id, {
        isArchived: false,
        archivedAt: undefined,
      });

      this.logger.info(
        `Reference document with ID ${id} unarchived successfully`,
      );
      return { success: true, message: 'Document unarchived successfully' };
    } catch (error) {
      this.logger.error(`Failed to unarchive document: ${id}`, error);
      throw new Error(`Failed to unarchive reference document with ID ${id}`);
    }
  }
}
