import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { TenantService } from '../tenant.service';
import { Tenant, TenantStatus } from 'src/tenant/entity/tenant.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { UserRepository } from 'src/user/repository/user.repository';
import { TenantScenarioSharedService } from '../tenant-scenario-shared';
import { TenantScenarioPathSharedService } from '../tenant-scenario-path-shared';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { LogoUploadContentType } from 'src/tenant/enum/tenant.enum';

// Mock LoggerService
jest.mock('../../../logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
  },
}));

describe('TenantService', () => {
  let service: TenantService;
  let tenantRepository: jest.Mocked<Repository<Tenant>>;
  let tenantScenarioSharedService: jest.Mocked<TenantScenarioSharedService>;
  let tenantScenarioPathSharedService: jest.Mocked<TenantScenarioPathSharedService>;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<AppConfigService>;
  let s3Service: jest.Mocked<S3Service>;

  const mockTenant: Tenant = {
    id: 'test-tenant-id',
    name: 'Test Tenant',
    code: 'test-tenant',
    description: 'Test tenant description',
    status: TenantStatus.ACTIVE,
    metadata: { key: 'value' },
    settings: { setting: 'value' },
    logoUrl: undefined as any,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    deletedAt: undefined,
    createdBy: undefined,
    updatedBy: undefined,
  } as Tenant;

  const mockCreateTenantData = {
    name: 'New Tenant',
    code: 'new-tenant',
    description: 'New tenant description',
    metadata: { key: 'value' },
    settings: { setting: 'value' },
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const mockTenantsRepository = {
      getallTenants: jest.fn(),
    };

    const mockUserRepository = {
      getUserCountByTenantIds: jest.fn(),
    };

    const mockTenantScenarioSharedService = {
      assignGlobalScenariosToTenant: jest.fn(),
    };

    const mockTenantScenarioPathSharedService = {
      assignGlobalScenarioPathsToTenant: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const mockConfigService = {
      s3: {
        assetsBucket: 'test-assets-bucket',
        learnMediaPublicBucket: 'test-public-bucket',
      },
      aws: {
        region: 'ap-south-1',
      },
    };

    const mockS3Service = {
      sanitizeFileName: jest.fn((name: string) => name),
      generatePresignedUrl: jest.fn(),
      deleteObject: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        {
          provide: getRepositoryToken(Tenant),
          useValue: mockRepository,
        },
        {
          provide: TenantsRepository,
          useValue: mockTenantsRepository,
        },
        {
          provide: UserRepository,
          useValue: mockUserRepository,
        },
        {
          provide: TenantScenarioSharedService,
          useValue: mockTenantScenarioSharedService,
        },
        {
          provide: TenantScenarioPathSharedService,
          useValue: mockTenantScenarioPathSharedService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AppConfigService,
          useValue: mockConfigService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
    tenantRepository = module.get(getRepositoryToken(Tenant));
    tenantScenarioSharedService = module.get(TenantScenarioSharedService);
    tenantScenarioPathSharedService = module.get(
      TenantScenarioPathSharedService,
    );
    dataSource = module.get(DataSource);
    configService = module.get(AppConfigService);
    s3Service = module.get(S3Service);
  });

  afterEach(() => {
    jest.clearAllMocks();
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(undefined);
  });

  describe('findAll', () => {
    it('should return all tenants', async () => {
      const mockTenants = [mockTenant, { ...mockTenant, id: 'tenant-2' }];
      tenantRepository.find.mockResolvedValue(mockTenants);

      const result = await service.findAll();

      expect(tenantRepository.find).toHaveBeenCalled();
      expect(result).toEqual(mockTenants);
    });

    it('should return empty array when no tenants exist', async () => {
      tenantRepository.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create and save a new tenant successfully with global scenarios and paths', async () => {
      const createdTenant = { ...mockTenant, ...mockCreateTenantData };
      const mockEntityManager = {
        create: jest.fn().mockReturnValue(createdTenant),
        save: jest.fn().mockResolvedValue(createdTenant),
      };

      tenantRepository.findOne.mockResolvedValue(null);
      dataSource.transaction.mockImplementation((async (callback: any) => {
        return await callback(mockEntityManager);
      }) as any);

      tenantScenarioSharedService.assignGlobalScenariosToTenant.mockResolvedValue(
        undefined,
      );
      tenantScenarioPathSharedService.assignGlobalScenarioPathsToTenant.mockResolvedValue(
        undefined,
      );

      const result = await service.create(mockCreateTenantData);

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: [
          { name: mockCreateTenantData.name },
          { code: mockCreateTenantData.code },
        ],
      });
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(mockEntityManager.create).toHaveBeenCalledWith(
        Tenant,
        mockCreateTenantData,
      );
      expect(mockEntityManager.save).toHaveBeenCalledWith(
        Tenant,
        createdTenant,
      );
      expect(
        tenantScenarioSharedService.assignGlobalScenariosToTenant,
      ).toHaveBeenCalledWith(createdTenant.id, mockEntityManager);
      expect(
        tenantScenarioPathSharedService.assignGlobalScenarioPathsToTenant,
      ).toHaveBeenCalledWith(createdTenant.id, mockEntityManager);
      expect(result).toEqual(createdTenant);
    });

    it('should set createdBy and updatedBy when userId is available', async () => {
      const userId = '123';
      const createdTenant = { ...mockTenant, ...mockCreateTenantData };
      const mockEntityManager = {
        create: jest.fn().mockReturnValue(createdTenant),
        save: jest.fn().mockResolvedValue(createdTenant),
      };

      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(userId);
      tenantRepository.findOne.mockResolvedValue(null);
      dataSource.transaction.mockImplementation((async (callback: any) => {
        return await callback(mockEntityManager);
      }) as any);

      tenantScenarioSharedService.assignGlobalScenariosToTenant.mockResolvedValue(
        undefined,
      );
      tenantScenarioPathSharedService.assignGlobalScenarioPathsToTenant.mockResolvedValue(
        undefined,
      );

      await service.create(mockCreateTenantData);

      expect(mockEntityManager.create).toHaveBeenCalledWith(
        Tenant,
        expect.objectContaining({
          createdBy: 123,
          updatedBy: 123,
        }),
      );
    });

    it('should throw ConflictException when tenant name already exists', async () => {
      const existingTenant = { ...mockTenant, name: mockCreateTenantData.name };
      tenantRepository.findOne.mockResolvedValue(existingTenant);

      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        `Tenant with name "${mockCreateTenantData.name}" already exists`,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when tenant code already exists', async () => {
      const existingTenant = {
        ...mockTenant,
        name: 'Different Name',
        code: mockCreateTenantData.code,
      };
      tenantRepository.findOne.mockResolvedValue(existingTenant);

      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        `Tenant with code "${mockCreateTenantData.code}" already exists`,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when transaction fails', async () => {
      const error = new Error('Transaction failed');

      tenantRepository.findOne.mockResolvedValue(null);
      dataSource.transaction.mockRejectedValue(error);

      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        'Failed to create tenant: Transaction failed',
      );
    });
  });

  describe('findById', () => {
    it('should return tenant when found by ID', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.findById('test-tenant-id');

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-tenant-id' },
      });
      expect(result).toEqual(mockTenant);
    });

    it('should return null when tenant not found by ID', async () => {
      tenantRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('validateTenant', () => {
    it('should return true for existing active tenant', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant);

      const result = await service.validateTenant('test-tenant-id');

      expect(result).toBe(true);
    });

    it('should return false for non-existent tenant', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      const result = await service.validateTenant('non-existent-id');

      expect(result).toBe(false);
    });

    it('should return false for inactive tenant', async () => {
      const inactiveTenant = { ...mockTenant, status: TenantStatus.INACTIVE };
      jest.spyOn(service, 'findById').mockResolvedValue(inactiveTenant);

      const result = await service.validateTenant('test-tenant-id');

      expect(result).toBe(false);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant successfully', async () => {
      const updateDto = { description: 'Updated description' };
      const updatedTenant = { ...mockTenant, ...updateDto };

      jest
        .spyOn(service, 'findById')
        .mockResolvedValueOnce(mockTenant)
        .mockResolvedValueOnce(updatedTenant);

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      } as any);

      const result = await service.updateTenant(
        'test-tenant-id',
        updateDto as any,
      );

      expect(service.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(tenantRepository.update).toHaveBeenCalledWith(
        'test-tenant-id',
        updateDto,
      );
      expect(result).toEqual(updatedTenant);
    });

    it('should set updatedBy when userId is available', async () => {
      const userId = '456';
      const updateDto = { description: 'Updated description' };
      const updatedTenant = { ...mockTenant, ...updateDto };

      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(userId);
      jest
        .spyOn(service, 'findById')
        .mockResolvedValueOnce(mockTenant)
        .mockResolvedValueOnce(updatedTenant);

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      } as any);

      await service.updateTenant('test-tenant-id', updateDto as any);

      expect(tenantRepository.update).toHaveBeenCalledWith(
        'test-tenant-id',
        expect.objectContaining({
          updatedBy: 456,
        }),
      );
    });

    it('should throw NotFoundException when tenant not found', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      await expect(
        service.updateTenant('non-existent-id', { name: 'Test' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when name already exists', async () => {
      const updateDto = { name: 'Existing Tenant' };
      const existingTenant = {
        ...mockTenant,
        id: 'different-id',
        name: 'Existing Tenant',
      };

      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant);
      tenantRepository.findOne.mockResolvedValue(existingTenant);

      await expect(
        service.updateTenant('test-tenant-id', updateDto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPresignedUrlForOrganizationLogo', () => {
    it('should return presignedUrl and logoUrl', async () => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue('999');

      s3Service.sanitizeFileName.mockReturnValue('logo.png');
      s3Service.generatePresignedUrl.mockResolvedValue(
        'https://presigned.url' as any,
      );

      const dto = {
        fileName: 'logo.png',
        fileSize: 1000,
        contentType: LogoUploadContentType.PNG,
      };

      const res = await service.getPresignedUrlForOrganizationLogo(dto as any);

      expect(res.presignedUrl).toBe('https://presigned.url');
      expect(res.logoUrl).toContain(
        'https://test-assets-bucket.s3.ap-south-1.amazonaws.com/',
      );
      expect(s3Service.generatePresignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'test-assets-bucket',
          operation: 'put',
          contentType: dto.contentType,
          expiresIn: 600,
        }),
      );
    });

    it('should throw if assets bucket not configured', async () => {
      (configService.s3 as any).assetsBucket = undefined;

      const dto = {
        fileName: 'logo.png',
        fileSize: 1000,
        contentType: LogoUploadContentType.PNG,
      };

      await expect(
        service.getPresignedUrlForOrganizationLogo(dto as any),
      ).rejects.toThrow('S3 bucket name for assets bucket is not defined');
    });

    it('should throw BadRequestException for invalid contentType', async () => {
      const dto = {
        fileName: 'logo.exe',
        fileSize: 1000,
        contentType: 'application/x-msdownload',
      };

      await expect(
        service.getPresignedUrlForOrganizationLogo(dto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when fileSize exceeds 2MB', async () => {
      const dto = {
        fileName: 'logo.png',
        fileSize: 2 * 1024 * 1024 + 1,
        contentType: LogoUploadContentType.PNG,
      };

      await expect(
        service.getPresignedUrlForOrganizationLogo(dto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteOrganizationLogo', () => {
    it('should delete object and return success true for valid url', async () => {
      s3Service.deleteObject.mockResolvedValue(undefined as any);

      const res = await service.deleteOrganizationLogo({
        logoUrl:
          'https://test-public-bucket.s3.ap-south-1.amazonaws.com/org-logos/x.png',
      } as any);

      expect(s3Service.deleteObject).toHaveBeenCalledWith({
        bucket: 'test-assets-bucket',
        key: 'org-logos/x.png',
      });
      expect(res).toEqual({ success: true });
    });

    it('should return success false for invalid url', async () => {
      const res = await service.deleteOrganizationLogo({
        logoUrl: 'not-a-valid-s3-url',
      } as any);

      expect(s3Service.deleteObject).not.toHaveBeenCalled();
      expect(res).toEqual({ success: false });
    });

    it('should return success false when s3 delete throws', async () => {
      s3Service.deleteObject.mockRejectedValue(new Error('S3 error'));

      const res = await service.deleteOrganizationLogo({
        logoUrl:
          'https://test-public-bucket.s3.ap-south-1.amazonaws.com/org-logos/x.png',
      } as any);

      expect(res).toEqual({ success: false });
    });
  });
});
