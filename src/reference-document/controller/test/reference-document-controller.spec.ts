import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ReferenceDocumentController } from '../reference-document.controller';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { UserRole } from 'src/common/constants/user.constants';
import {
  AddDocumentDto,
  SearchDocumentsDto,
  UpdateReferenceDocumentDto,
} from 'src/reference-document/dto/reference-document.dto';
import { ReferenceDocumentService } from 'src/reference-document/service/reference-document.service';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { UserService } from '../../../user/service/user.service';
import { AppConfigService } from '../../../config/config.service';

describe('ReferenceDocumentController', () => {
  let controller: ReferenceDocumentController;
  let service: jest.Mocked<ReferenceDocumentService>;

  const tokenUser = { id: 42, role: UserRole.ADMIN } as any;

  const mockService: jest.Mocked<ReferenceDocumentService> = {
    addReferenceDocument: jest.fn(),
    searchTenantDocuments: jest.fn(),
    updateReferenceDocument: jest.fn(),
    bulkCreateFromCsv: jest.fn(),
    getDistinctCategories: jest.fn(),
    getPrivateReferenceDocument: jest.fn(),
    deleteReferenceDocument: jest.fn(),
    archiveReferenceDocument: jest.fn(),
    unarchiveReferenceDocument: jest.fn(),
  } as any;

  const allowGuard: CanActivate = { canActivate: () => true };

  const mockPermissionsService = {
    getUserPermissions: jest.fn(),
  };

  const mockUserService = {
    getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
  };

  const mockAppConfigService = {
    featureFlag: {
      termsAndAgreement: false,
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReferenceDocumentController],
      providers: [
        { provide: ReferenceDocumentService, useValue: mockService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: UserService, useValue: mockUserService },
        { provide: AppConfigService, useValue: mockAppConfigService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(allowGuard)
      .compile();

    controller = module.get<ReferenceDocumentController>(
      ReferenceDocumentController,
    );
    service = module.get(
      ReferenceDocumentService,
    ) as jest.Mocked<ReferenceDocumentService>;
  });

  it('addDocument happy', async () => {
    const dto: AddDocumentDto = {
      heading: 'h',
      content: 'c',
      category: 'cat',
      tags: ['t'],
      isPublic: true,
    };
    const expected = { id: 'doc1', uploadStatus: 'SUCCESS' };
    service.addReferenceDocument.mockResolvedValueOnce(expected as any);

    const result = await controller.addDocument(tokenUser, dto);

    expect(service.addReferenceDocument).toHaveBeenCalledWith(
      tokenUser.id,
      dto,
    );
    expect(result).toBe(expected);
  });

  it('addDocument negative (bubble)', async () => {
    service.addReferenceDocument.mockRejectedValueOnce(new Error('fail'));
    await expect(controller.addDocument(tokenUser, {} as any)).rejects.toThrow(
      'fail',
    );
  });

  it('searchTenantDocuments happy', async () => {
    const dto: SearchDocumentsDto = { query: 'q' } as any;
    const expected = { documents: [], total: 0 };
    service.searchTenantDocuments.mockResolvedValueOnce(expected as any);
    const result = await controller.searchTenantDocuments(dto);
    expect(service.searchTenantDocuments).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('updateDocument happy', async () => {
    const id = 'abc';
    const dto: UpdateReferenceDocumentDto = { heading: 'H' } as any;
    const expected = { id, uploadStatus: 'SUCCESS' };
    service.updateReferenceDocument.mockResolvedValueOnce(expected as any);
    const result = await controller.updateDocument(id, dto);
    expect(service.updateReferenceDocument).toHaveBeenCalledWith(id, dto);
    expect(result).toBe(expected);
  });

  it('uploadCsv happy', async () => {
    const file = { buffer: Buffer.from('csv') } as any;
    const expected = { total: 1, successCount: 1, errorCount: 0 };
    service.bulkCreateFromCsv.mockResolvedValueOnce(expected as any);
    const result = await controller.uploadCsv(tokenUser, file);
    expect(service.bulkCreateFromCsv).toHaveBeenCalledWith(tokenUser.id, file);
    expect(result).toBe(expected);
  });

  it('getCategories happy', async () => {
    const expected = ['A', 'B'];
    service.getDistinctCategories.mockResolvedValueOnce(expected as any);
    const result = await controller.getCategories();
    expect(service.getDistinctCategories).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('getPrivateDocument happy', async () => {
    const id = 'priv1';
    const expected = { id, heading: 'H' };
    service.getPrivateReferenceDocument.mockResolvedValueOnce(expected as any);
    const result = await controller.getPrivateDocument(id);
    expect(service.getPrivateReferenceDocument).toHaveBeenCalledWith(id);
    expect(result).toBe(expected);
  });

  it('deleteDocument happy', async () => {
    const id = 'd1';
    const expected = { success: true };
    service.deleteReferenceDocument.mockResolvedValueOnce(expected as any);
    const result = await controller.deleteDocument(id);
    expect(service.deleteReferenceDocument).toHaveBeenCalledWith(id);
    expect(result).toBe(expected);
  });

  it('archiveDocument happy', async () => {
    const id = 'a1';
    const expected = { success: true };
    service.archiveReferenceDocument.mockResolvedValueOnce(expected as any);
    const result = await controller.archiveDocument(id);
    expect(service.archiveReferenceDocument).toHaveBeenCalledWith(id);
    expect(result).toBe(expected);
  });

  it('unarchiveDocument happy', async () => {
    const id = 'u1';
    const expected = { success: true };
    service.unarchiveReferenceDocument.mockResolvedValueOnce(expected as any);
    const result = await controller.unarchiveDocument(id);
    expect(service.unarchiveReferenceDocument).toHaveBeenCalledWith(id);
    expect(result).toBe(expected);
  });
});
