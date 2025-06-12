import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DocumentUploadStatus,
  ReferenceDocument,
} from '../../common/entities/reference-document.entity';
import {
  AddDocumentDto,
  SearchDocumentsDto,
} from '../dto/reference-document.dto';
import { AiService } from '../../ai/service/ai.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SearchOperationFailedException } from '../exception/reference-document.exception';
import { LoggerService } from '../../logger/logger.service';

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

  async addReferenceDocument(userId: number, dto: AddDocumentDto) {
    const document = this.referenceDocumentRepository.create({
      ...dto,
      createdBy: userId,
      uploadStatus: DocumentUploadStatus.PENDING,
    });

    const savedDocument = await this.referenceDocumentRepository.save(document);

    const request = {
      document_id: savedDocument.id,
      heading: savedDocument.heading,
      content: savedDocument.content,
      category: savedDocument.category,
      tags: savedDocument.tags,
      tenant_id: ExecutionManager.getTenantId()!,
    };

    try {
      const response = await this.aiService.addReferenceDocument(request);
      if (response.id) {
        savedDocument.uploadStatus = DocumentUploadStatus.SUCCESS;
        await this.referenceDocumentRepository.update(savedDocument.id, {
          uploadStatus: DocumentUploadStatus.SUCCESS,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to add reference document to AI service for document ID: ${savedDocument.id}`,
        error,
      );
      // TODO: implement retry and handle the status
      savedDocument.uploadStatus = DocumentUploadStatus.FAILED;
      await this.referenceDocumentRepository.update(savedDocument.id, {
        uploadStatus: DocumentUploadStatus.FAILED,
      });
    }

    return {
      id: savedDocument.id,
      uploadStatus: savedDocument.uploadStatus,
    };
  }

  async searchPublicDocuments(searchDto: SearchDocumentsDto) {
    const publicDocuments = await this.referenceDocumentRepository.find({
      where: {
        isPublic: true,
        uploadStatus: DocumentUploadStatus.SUCCESS,
      },
    });

    if (publicDocuments.length === 0) {
      this.logger.info(
        `searchPublicDocuments: No public documents found for search query: ${searchDto.query}`,
      );
      return {
        documents: [],
        total: 0,
      };
    }

    const publicDocumentIds = publicDocuments.map((doc) => doc.id);

    let documentIdsToSearch = publicDocumentIds;
    if (searchDto.excludedIds) {
      documentIdsToSearch = publicDocumentIds.filter(
        (documentId) => !searchDto.excludedIds?.includes(documentId),
      );
    }

    if (documentIdsToSearch.length === 0) {
      this.logger.info(
        `searchPublicDocuments: No public documents found other than the ones in the excluded_ids for search query: ${searchDto.query}`,
      );
      return {
        documents: [],
        total: 0,
      };
    }

    const searchRequest = {
      query: searchDto.query,
      limit: Number(searchDto.limit) || 10,
      document_ids: documentIdsToSearch,
      ...(searchDto.filters && { filters: searchDto.filters }),
      ...(searchDto.sortBy && { sort_by: searchDto.sortBy }),
      ...(searchDto.sortOrder && { sort_order: searchDto.sortOrder }),
    };

    try {
      this.logger.info(
        `Performing search operation with query: "${searchDto.query}", limit: ${searchRequest.limit}`,
      );

      const response =
        await this.aiService.searchReferenceDocuments(searchRequest);

      const documents = response.documents.map(this.mapDocument);

      return {
        documents,
        total: response.total,
        limit: response.limit,
      };
    } catch (error) {
      this.logger.error(
        `Search operation failed for query: "${searchDto.query}"`,
        {
          searchRequest,
          error: error.message || error,
          stack: error.stack,
        },
      );
      throw new SearchOperationFailedException(
        'Failed to search reference documents',
        error,
      );
    }
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
}
