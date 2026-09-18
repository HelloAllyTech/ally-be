import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReferenceDocumentService } from '../reference-document.service';
import {
  DocumentUploadStatus,
  ReferenceDocument,
} from '../../entity/reference-document.entity';
import { AiService } from 'src/ai/service/ai.service';
import {
  SearchOperationFailedException,
  DocumentUpdateFailedException,
  DocumentArchiveFailedException,
  DocumentUnarchiveFailedException,
} from 'src/reference-document/exception/reference-document.exception';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { OrganizationRequiredException } from 'src/exception/custom.exception';
import { parseCsvBuffer } from 'src/common/util/csv.util';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ReferenceDocumentRepository } from 'src/reference-document/repository/reference-document.repository';

import {
  AddReferenceDocumentResponse,
  SearchReferenceDocumentsResponse,
  UpdateReferenceDocumentResponse,
  GetReferenceDocumentResponse,
  DeleteReferenceDocumentResponse,
} from 'src/ai/dto/ai.response.dto';

// Mocks
jest.mock('src/common/execution/execution-manager');
jest.mock('src/logger/logger.service');
jest.mock('src/common/util/csv.util');

describe('ReferenceDocumentService', () => {
  let service: ReferenceDocumentService;
  let repo: jest.Mocked<ReferenceDocumentRepository>;
  let ai: jest.Mocked<AiService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;

  const now = new Date();

  const baseDocument: ReferenceDocument = {
    id: 'doc-1',
    heading: 'H',
    content: 'C',
    category: 'Cat',
    tags: ['t1'],
    isPublic: false,
    isArchived: false,
    uploadStatus: DocumentUploadStatus.PENDING,
    organizationId: 'org-1',
    createdBy: 10,
    createdAt: now,
    updatedAt: now,
    archivedAt: undefined,
  };

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    createQueryBuilder: jest.fn(),
    getDistinctCategories: jest.fn(),
  } as unknown as jest.Mocked<ReferenceDocumentRepository>;

  const mockAi: jest.Mocked<AiService> = {
    addReferenceDocument: jest.fn(),
    searchReferenceDocuments: jest.fn(),
    updateReferenceDocument: jest.fn(),
    getReferenceDocument: jest.fn(),
    deleteReferenceDocument: jest.fn(),
  } as any;

  const mockPermissionValidator: jest.Mocked<PermissionValidator> = {
    validatePermissions: jest.fn(),
  } as any;

  beforeEach(async () => {
    jest.resetAllMocks();

    // Logger to no-op
    (LoggerService.getInstance as any).mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferenceDocumentService,
        { provide: ReferenceDocumentRepository, useValue: mockRepo },
        { provide: AiService, useValue: mockAi },
        { provide: PermissionValidator, useValue: mockPermissionValidator },
      ],
    }).compile();

    service = module.get(ReferenceDocumentService);
    repo = module.get(ReferenceDocumentRepository);
    ai = module.get(AiService);
    permissionValidator = module.get(PermissionValidator);
  });

  describe('addReferenceDocument', () => {
    it('creates public doc -> SUCCESS when AI returns id', async () => {
      const dto: any = {
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: ['t1'],
        isPublic: true,
      };
      const saved = {
        ...baseDocument,
        isPublic: true,
        organizationId: undefined,
        id: 'new-id',
      };
      repo.create.mockReturnValue(saved as any);
      repo.save.mockResolvedValue(saved as any);

      ai.addReferenceDocument.mockResolvedValue({
        id: 'ai-id',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: '',
      } as unknown as AddReferenceDocumentResponse);

      repo.update.mockResolvedValue({} as any);

      permissionValidator.validatePermissions.mockResolvedValue(true);
      const res = await service.addReferenceDocument(100, dto);

      expect(repo.create).toHaveBeenCalledWith({
        ...dto,
        createdBy: 100,
        uploadStatus: DocumentUploadStatus.PENDING,
        organizationId: undefined,
      });
      expect(ai.addReferenceDocument).toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('new-id', {
        uploadStatus: DocumentUploadStatus.SUCCESS,
      });
      expect(res).toEqual({
        id: 'new-id',
        uploadStatus: DocumentUploadStatus.SUCCESS,
      });
    });

    it('creates private doc as ADMIN pulls tenant from ExecutionManager', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-ADMIN');
      const dto: any = {
        heading: 'H',
        content: 'C',
        category: 'Cat',
        isPublic: false,
      };
      const saved = {
        ...baseDocument,
        id: 'x1',
        organizationId: 'org-ADMIN',
        isPublic: false,
      };
      repo.create.mockReturnValue(saved as any);
      repo.save.mockResolvedValue(saved as any);

      ai.addReferenceDocument.mockResolvedValue({
        id: 'ai-id',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: 'org-ADMIN',
      } as unknown as AddReferenceDocumentResponse);

      repo.update.mockResolvedValue({} as any);

      permissionValidator.validatePermissions.mockResolvedValue(true);
      const res = await service.addReferenceDocument(5, dto);
      expect(repo.create).toHaveBeenCalledWith({
        ...dto,
        createdBy: 5,
        uploadStatus: DocumentUploadStatus.PENDING,
        organizationId: 'org-ADMIN',
      });
      expect(res.uploadStatus).toBe(DocumentUploadStatus.SUCCESS);
    });

    it('throws OrganizationRequiredException if private and missing org', async () => {
      const dto: any = {
        heading: 'H',
        content: 'C',
        category: 'Cat',
        isPublic: false,
      };
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(undefined);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      await expect(service.addReferenceDocument(1, dto)).rejects.toThrow(
        OrganizationRequiredException,
      );
    });

    it('marks FAILED when AI throws, and rethrows if repo update fails second phase', async () => {
      const dto: any = {
        heading: 'H',
        content: 'C',
        category: 'Cat',
        isPublic: true,
      };
      const saved = {
        ...baseDocument,
        id: 'z1',
        isPublic: true,
        organizationId: undefined,
      };
      repo.create.mockReturnValue(saved as any);
      repo.save.mockResolvedValue(saved as any);

      ai.addReferenceDocument.mockRejectedValue(new Error('AI fail'));

      permissionValidator.validatePermissions.mockResolvedValue(true);
      repo.update.mockRejectedValueOnce(new Error('DB update fail'));
      await expect(service.addReferenceDocument(1, dto)).rejects.toThrow(
        DocumentUpdateFailedException,
      );
    });

    it('marks FAILED when AI returns no id', async () => {
      const dto: any = {
        heading: 'H',
        content: 'C',
        category: 'Cat',
        isPublic: true,
      };
      const saved = {
        ...baseDocument,
        id: 'k1',
        isPublic: true,
        organizationId: undefined,
      };
      repo.create.mockReturnValue(saved as any);
      repo.save.mockResolvedValue(saved as any);

      ai.addReferenceDocument.mockResolvedValue(
        {} as unknown as AddReferenceDocumentResponse,
      );

      repo.update.mockResolvedValue({} as any);

      permissionValidator.validatePermissions.mockResolvedValue(true);
      const res = await service.addReferenceDocument(1, dto);
      expect(res).toEqual({
        id: 'k1',
        uploadStatus: DocumentUploadStatus.FAILED,
      });
    });
  });

  describe('searchDocumentsByIds (via tenant search)', () => {
    beforeEach(() => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
    });

    it('returns empty when none available', async () => {
      repo.find.mockResolvedValue([]);
      const res = await service.searchTenantDocuments({ query: 'q' } as any);
      expect(res).toEqual({ documents: [], total: 0, categories: {} });
    });

    it('searches when available and not excluded', async () => {
      repo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any);

      ai.searchReferenceDocuments.mockResolvedValue({
        documents: [
          {
            id: 'a',
            heading: 'H',
            content: 'C',
            category: 'Cat',
            tags: [],
            score: 0,
          },
        ],
        total: 1,
        limit: 10,
        categories: { Cat: 1 },
      } as unknown as SearchReferenceDocumentsResponse);

      const res = await service.searchTenantDocuments({ query: 'q' } as any);
      expect(ai.searchReferenceDocuments).toHaveBeenCalledWith({
        query: 'q',
        limit: 10,
        document_ids: ['a', 'b'],
      });
      expect(res.total).toBe(1);
    });

    it('skips when all excluded', async () => {
      repo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any);
      const res = await service.searchTenantDocuments({
        query: 'q',
        excludedIds: ['a', 'b'],
      } as any);
      expect(res).toEqual({ documents: [], total: 0, categories: {} });
    });

    it('bubbles SearchOperationFailedException on AI error', async () => {
      repo.find.mockResolvedValue([{ id: 'a' }] as any);
      ai.searchReferenceDocuments.mockRejectedValue(new Error('AI search'));
      await expect(
        service.searchTenantDocuments({ query: 'q' } as any),
      ).rejects.toThrow(SearchOperationFailedException);
    });
  });

  describe('searchTenantDocuments', () => {
    it('throws OrganizationRequiredException when tenant missing', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(undefined);
      await expect(
        service.searchTenantDocuments({ query: 'q' } as any),
      ).rejects.toThrow(OrganizationRequiredException);
    });

    it('searches with union of public + org', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
      repo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any);

      ai.searchReferenceDocuments.mockResolvedValue({
        documents: [
          {
            id: 'b',
            heading: 'H',
            content: 'C',
            category: 'Cat',
            tags: [],
            score: 0,
          },
        ],
        total: 1,
        limit: 10,
        categories: {},
      } as unknown as SearchReferenceDocumentsResponse);

      const res = await service.searchTenantDocuments({ query: 'q' } as any);
      expect(res.total).toBe(1);
    });
  });

  describe('buildSearchRequest + mapDocument via tenant search', () => {
    it('passes filters/sort into ai request and maps score', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
      repo.find.mockResolvedValue([{ id: 'd1' }] as any);

      ai.searchReferenceDocuments.mockResolvedValue({
        documents: [
          {
            id: 'd1',
            heading: 'H',
            content: 'C',
            category: 'Cat',
            tags: ['x'],
            score: 0.9,
          },
        ],
        total: 1,
        limit: 5,
        categories: {},
      } as unknown as SearchReferenceDocumentsResponse);

      const res = await service.searchTenantDocuments({
        query: 'q',
        limit: 5,
        filters: { category: 'Cat' },
        sortBy: 'relevance',
        sortOrder: 'desc',
      } as any);

      expect(ai.searchReferenceDocuments).toHaveBeenCalledWith({
        query: 'q',
        limit: 5,
        document_ids: ['d1'],
        filters: { category: 'Cat' },
        sort_by: 'relevance',
        sort_order: 'desc',
      });
      expect(res.documents[0]).toEqual({
        id: 'd1',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: ['x'],
        score: 0.9,
      });
    });
  });

  describe('updateReferenceDocument', () => {
    it('throws NotFound if missing', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(
        service.updateReferenceDocument('nope', { heading: 'X' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('success -> AI returns id -> SUCCESS then update', async () => {
      repo.findOneBy.mockResolvedValue(baseDocument as any);
      repo.update.mockResolvedValue({} as any);

      ai.updateReferenceDocument.mockResolvedValue({
        id: 'ai-id',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: '',
      } as unknown as UpdateReferenceDocumentResponse);

      const res = await service.updateReferenceDocument('doc-1', {
        heading: 'X',
      } as any);
      expect(repo.update).toHaveBeenCalledTimes(2);
      expect(res).toEqual({
        id: 'doc-1',
        uploadStatus: DocumentUploadStatus.SUCCESS,
      });
    });

    it('ai throws -> FAILED persists', async () => {
      repo.findOneBy.mockResolvedValue(baseDocument as any);
      repo.update.mockResolvedValue({} as any);
      ai.updateReferenceDocument.mockRejectedValue(new Error('AI fail'));
      const res = await service.updateReferenceDocument('doc-1', {
        heading: 'X',
      } as any);
      expect(res.uploadStatus).toBe(DocumentUploadStatus.FAILED);
    });
  });

  describe('bulkCreateFromCsv', () => {
    it('throws on missing file', async () => {
      await expect(
        service.bulkCreateFromCsv(1, { buffer: undefined } as any),
      ).rejects.toThrow('No file uploaded or file is empty');
    });

    it('processes all rows with mixed success', async () => {
      (parseCsvBuffer as jest.Mock).mockReturnValue([
        {
          Heading: 'H1',
          Description: 'D1',
          'Content Category': 'C1',
          Keywords: 'a,b',
        },
        { Heading: 'H2', Description: 'D2', 'Content Category': 'C2' },
      ]);
      jest
        .spyOn(service as any, 'addReferenceDocument')
        .mockResolvedValueOnce({ id: 'id1' })
        .mockRejectedValueOnce(new Error('fail row'));

      const res = await service.bulkCreateFromCsv(99, {
        buffer: Buffer.from('csv'),
      } as any);
      expect(res.total).toBe(2);
      expect(res.successCount).toBe(1);
      expect(res.errorCount).toBe(1);
      expect(res.results[0]).toEqual({ success: true, id: 'id1' });
      expect(res.results[1].success).toBe(false);
    });
  });

  describe('getDistinctCategories', () => {
    it('returns mapped categories', async () => {
      (repo.getDistinctCategories as jest.Mock).mockResolvedValue([
        { category: 'A', count: 5 },
        { category: 'B', count: 3 },
      ]);

      const res = await service.getDistinctCategories();
      expect(repo.getDistinctCategories).toHaveBeenCalled();
      expect(res).toEqual(['A', 'B']);
    });
  });

  describe('getReferenceDocument', () => {
    it('returns ai doc', async () => {
      ai.getReferenceDocument.mockResolvedValue({
        id: 'x',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: '',
      } as unknown as GetReferenceDocumentResponse);
      const res = await service.getReferenceDocument('x');
      expect(res).toEqual({
        id: 'x',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: '',
      });
    });

    it('throws NotFound on AI error', async () => {
      ai.getReferenceDocument.mockRejectedValue(new Error('AI fail'));
      await expect(service.getReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPrivateReferenceDocument', () => {
    it('throws OrganizationRequiredException if no tenant', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(undefined);
      await expect(service.getPrivateReferenceDocument('x')).rejects.toThrow(
        OrganizationRequiredException,
      );
    });

    it('throws NotFound if not found', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.getPrivateReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFound if access denied by org mismatch', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-2');
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        organizationId: 'org-1',
        isPublic: false,
      } as any);
      await expect(service.getPrivateReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns ai doc when ok', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        organizationId: 'org-1',
      } as any);

      ai.getReferenceDocument.mockResolvedValue({
        id: 'x',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: 'org-1',
      } as unknown as GetReferenceDocumentResponse);

      const res = await service.getPrivateReferenceDocument('x');
      expect(res).toEqual({
        id: 'x',
        heading: 'H',
        content: 'C',
        category: 'Cat',
        tags: [],
        tenant_id: 'org-1',
      });
    });

    it('throws NotFound when AI fails', async () => {
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue('org-1');
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        organizationId: 'org-1',
      } as any);
      ai.getReferenceDocument.mockRejectedValue(new Error('AI fail'));
      await expect(service.getPrivateReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteReferenceDocument', () => {
    it('throws NotFound when doc missing', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.deleteReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('happy delete', async () => {
      repo.findOneBy.mockResolvedValue(baseDocument as any);
      ai.deleteReferenceDocument.mockResolvedValue({
        success: true,
      } as unknown as DeleteReferenceDocumentResponse);
      repo.delete.mockResolvedValue({} as any);
      const res = await service.deleteReferenceDocument('x');
      expect(res).toEqual({ success: true });
    });

    it('throws generic Error when AI/delete fails', async () => {
      repo.findOneBy.mockResolvedValue(baseDocument as any);
      ai.deleteReferenceDocument.mockRejectedValue(new Error('AI fail'));
      await expect(service.deleteReferenceDocument('x')).rejects.toThrow(
        'Failed to delete reference document with ID x',
      );
    });
  });

  describe('archiveReferenceDocument', () => {
    it('throws NotFound when missing', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.archiveReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns already archived', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: true,
      } as any);
      const res = await service.archiveReferenceDocument('x');
      expect(res).toEqual({
        success: true,
        message: 'Document is already archived',
      });
    });

    it('happy archive', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: false,
      } as any);
      repo.update.mockResolvedValue({} as any);
      const res = await service.archiveReferenceDocument('x');
      expect(repo.update).toHaveBeenCalledWith('x', {
        isArchived: true,
        archivedAt: expect.any(Date),
      });
      expect(res).toEqual({
        success: true,
        message: 'Document archived successfully',
      });
    });

    it('throws DocumentArchiveFailedException when repo fails', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: false,
      } as any);
      repo.update.mockRejectedValue(new Error('fail'));
      await expect(service.archiveReferenceDocument('x')).rejects.toThrow(
        DocumentArchiveFailedException,
      );
    });
  });

  describe('unarchiveReferenceDocument', () => {
    it('throws NotFound when missing', async () => {
      repo.findOneBy.mockResolvedValue(null);
      await expect(service.unarchiveReferenceDocument('x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns not archived', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: false,
      } as any);
      const res = await service.unarchiveReferenceDocument('x');
      expect(res).toEqual({
        success: true,
        message: 'Document is not archived',
      });
    });

    it('happy unarchive', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: true,
      } as any);
      repo.update.mockResolvedValue({} as any);
      const res = await service.unarchiveReferenceDocument('x');
      expect(repo.update).toHaveBeenCalledWith('x', {
        isArchived: false,
        archivedAt: undefined,
      });
      expect(res).toEqual({
        success: true,
        message: 'Document unarchived successfully',
      });
    });

    it('throws DocumentUnarchiveFailedException when repo fails', async () => {
      repo.findOneBy.mockResolvedValue({
        ...baseDocument,
        isArchived: true,
      } as any);
      repo.update.mockRejectedValue(new Error('fail'));
      await expect(service.unarchiveReferenceDocument('x')).rejects.toThrow(
        DocumentUnarchiveFailedException,
      );
    });
  });

  describe('getDistinctCategories (additional)', () => {
    it('returns empty array when no categories exist', async () => {
      (repo.getDistinctCategories as jest.Mock).mockResolvedValue([]);

      const res = await service.getDistinctCategories();
      expect(repo.getDistinctCategories).toHaveBeenCalled();
      expect(res).toEqual([]);
    });
  });

  describe('bulkCreateFromCsv', () => {
    it('throws on missing file', async () => {
      await expect(
        service.bulkCreateFromCsv(1, { buffer: undefined } as any),
      ).rejects.toThrow('No file uploaded or file is empty');
    });

    it('processes all rows with mixed success', async () => {
      (parseCsvBuffer as jest.Mock).mockReturnValue([
        {
          Heading: 'H1',
          Description: 'D1',
          'Content Category': 'C1',
          Keywords: 'a,b',
        },
        { Heading: 'H2', Description: 'D2', 'Content Category': 'C2' },
      ]);
      jest
        .spyOn(service as any, 'addReferenceDocument')
        .mockResolvedValueOnce({ id: 'id1' })
        .mockRejectedValueOnce(new Error('fail row'));

      const res = await service.bulkCreateFromCsv(99, {
        buffer: Buffer.from('csv'),
      } as any);
      expect(res.total).toBe(2);
      expect(res.successCount).toBe(1);
      expect(res.errorCount).toBe(1);
      expect(res.results[0]).toEqual({ success: true, id: 'id1' });
      expect(res.results[1].success).toBe(false);
    });
  });
});
