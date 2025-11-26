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

describe('TenantService', () => {
  let service: TenantService;
  let tenantRepository: jest.Mocked<Repository<Tenant>>;
  let tenantScenarioSharedService: jest.Mocked<TenantScenarioSharedService>;
  let tenantScenarioPathSharedService: jest.Mocked<TenantScenarioPathSharedService>;
  let dataSource: jest.Mocked<DataSource>;

  const mockTenant: Tenant = {
    id: 'test-tenant-id',
    name: 'Test Tenant',
    code: 'test-tenant',
    description: 'Test tenant description',
    status: TenantStatus.ACTIVE,
    metadata: { key: 'value' },
    settings: { setting: 'value' },
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-01'),
    deletedAt: undefined,
  };

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
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
    tenantRepository = module.get(getRepositoryToken(Tenant));
    tenantScenarioSharedService = module.get(TenantScenarioSharedService);
    tenantScenarioPathSharedService = module.get(
      TenantScenarioPathSharedService,
    );
    dataSource = module.get(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
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
      });

      const result = await service.updateTenant('test-tenant-id', updateDto);

      expect(service.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(tenantRepository.update).toHaveBeenCalledWith(
        'test-tenant-id',
        updateDto,
      );
      expect(result).toEqual(updatedTenant);
    });

    it('should throw NotFoundException when tenant not found', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      await expect(
        service.updateTenant('non-existent-id', { name: 'Test' }),
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
        service.updateTenant('test-tenant-id', updateDto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
