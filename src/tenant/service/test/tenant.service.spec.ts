import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { TenantService } from '../tenant.service';
import { Tenant, TenantStatus } from 'src/common/entities/tenant.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { UserRepository } from 'src/user/repository/user.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
  let tenantsRepository: jest.Mocked<TenantsRepository>;
  let userRepository: jest.Mocked<UserRepository>;

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
      getUserCount: jest.fn(),
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
      ],
    }).compile();

    service = module.get<TenantService>(TenantService);
    tenantRepository = module.get(getRepositoryToken(Tenant));
    tenantsRepository = module.get(TenantsRepository);
    userRepository = module.get(UserRepository);
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

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      tenantRepository.find.mockRejectedValue(error);

      await expect(service.findAll()).rejects.toThrow('Database error');
    });
  });

  describe('create', () => {
    it('should create and save a new tenant successfully', async () => {
      const createdTenant = { ...mockTenant, ...mockCreateTenantData };
      tenantRepository.create.mockReturnValue(createdTenant as any);
      tenantRepository.save.mockResolvedValue(createdTenant);

      const result = await service.create(mockCreateTenantData);

      expect(tenantRepository.create).toHaveBeenCalledWith(
        mockCreateTenantData,
      );
      expect(tenantRepository.save).toHaveBeenCalledWith(createdTenant);
      expect(result).toEqual(createdTenant);
    });

    it('should handle repository errors during tenant creation', async () => {
      const error = new Error('Database error');
      tenantRepository.create.mockReturnValue(mockTenant as any);
      tenantRepository.save.mockRejectedValue(error);

      await expect(service.create(mockCreateTenantData)).rejects.toThrow(
        'Database error',
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

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
      expect(result).toBeNull();
    });

    it('should handle repository errors during findById', async () => {
      const error = new Error('Database error');
      tenantRepository.findOne.mockRejectedValue(error);

      await expect(service.findById('test-tenant-id')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('findByCode', () => {
    it('should return tenant when found by code', async () => {
      tenantRepository.findOne.mockResolvedValue(mockTenant);

      const result = await service.findByCode('test-tenant');

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'test-tenant' },
      });
      expect(result).toEqual(mockTenant);
    });

    it('should return null when tenant not found by code', async () => {
      tenantRepository.findOne.mockResolvedValue(null);

      const result = await service.findByCode('non-existent-code');

      expect(tenantRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'non-existent-code' },
      });
      expect(result).toBeNull();
    });

    it('should handle repository errors during findByCode', async () => {
      const error = new Error('Database error');
      tenantRepository.findOne.mockRejectedValue(error);

      await expect(service.findByCode('test-tenant')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('updateStatus', () => {
    it('should update tenant status and return updated tenant when successful', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      const mockUpdateResult: UpdateResult = {
        affected: 1,
        raw: [{ ...mockTenant, status: TenantStatus.INACTIVE }],
        generatedMaps: [],
      };

      tenantRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      mockQueryBuilder.execute.mockResolvedValue(mockUpdateResult);

      const result = await service.updateStatus(
        'test-tenant-id',
        TenantStatus.INACTIVE,
      );

      expect(tenantRepository.createQueryBuilder).toHaveBeenCalled();
      expect(mockQueryBuilder.update).toHaveBeenCalledWith(Tenant);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({
        status: TenantStatus.INACTIVE,
      });
      expect(mockQueryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: 'test-tenant-id',
      });
      expect(mockQueryBuilder.returning).toHaveBeenCalledWith('*');
      expect(result).toEqual({ ...mockTenant, status: TenantStatus.INACTIVE });
    });

    it('should return null when no tenant is affected by status update', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      };
      const mockUpdateResult: UpdateResult = {
        affected: 0,
        raw: [],
        generatedMaps: [],
      };

      tenantRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );
      mockQueryBuilder.execute.mockResolvedValue(mockUpdateResult);

      const result = await service.updateStatus(
        'non-existent-id',
        TenantStatus.INACTIVE,
      );

      expect(result).toBeNull();
    });

    it('should handle repository errors during status update', async () => {
      const error = new Error('Database error');
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        execute: jest.fn().mockRejectedValue(error),
      };

      tenantRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      await expect(
        service.updateStatus('test-tenant-id', TenantStatus.INACTIVE),
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateSettings', () => {
    it('should update tenant settings and return updated tenant', async () => {
      const newSettings = { newSetting: 'newValue' };
      const updatedTenant = { ...mockTenant, settings: newSettings };

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      jest.spyOn(service, 'findById').mockResolvedValue(updatedTenant);

      const result = await service.updateSettings(
        'test-tenant-id',
        newSettings,
      );

      expect(tenantRepository.update).toHaveBeenCalledWith('test-tenant-id', {
        settings: newSettings,
      });
      expect(service.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(result).toEqual(updatedTenant);
    });

    it('should return null when tenant not found after settings update', async () => {
      const newSettings = { newSetting: 'newValue' };

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      const result = await service.updateSettings(
        'non-existent-id',
        newSettings,
      );

      expect(result).toBeNull();
    });

    it('should handle repository errors during settings update', async () => {
      const error = new Error('Database error');
      tenantRepository.update.mockRejectedValue(error);

      await expect(
        service.updateSettings('test-tenant-id', {}),
      ).rejects.toThrow('Database error');
    });
  });

  describe('updateMetadata', () => {
    it('should update tenant metadata and return updated tenant', async () => {
      const newMetadata = { newKey: 'newValue' };
      const updatedTenant = { ...mockTenant, metadata: newMetadata };

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      jest.spyOn(service, 'findById').mockResolvedValue(updatedTenant);

      const result = await service.updateMetadata(
        'test-tenant-id',
        newMetadata,
      );

      expect(tenantRepository.update).toHaveBeenCalledWith('test-tenant-id', {
        metadata: newMetadata,
      });
      expect(service.findById).toHaveBeenCalledWith('test-tenant-id');
      expect(result).toEqual(updatedTenant);
    });

    it('should return null when tenant not found after metadata update', async () => {
      const newMetadata = { newKey: 'newValue' };

      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      jest.spyOn(service, 'findById').mockResolvedValue(null);

      const result = await service.updateMetadata(
        'non-existent-id',
        newMetadata,
      );

      expect(result).toBeNull();
    });

    it('should handle repository errors during metadata update', async () => {
      const error = new Error('Database error');
      tenantRepository.update.mockRejectedValue(error);

      await expect(
        service.updateMetadata('test-tenant-id', {}),
      ).rejects.toThrow('Database error');
    });
  });

  describe('validateTenant', () => {
    it('should return true for existing active tenant', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant);

      const result = await service.validateTenant('test-tenant-id');

      expect(service.findById).toHaveBeenCalledWith('test-tenant-id');
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

    it('should return false for suspended tenant', async () => {
      const suspendedTenant = { ...mockTenant, status: TenantStatus.SUSPENDED };
      jest.spyOn(service, 'findById').mockResolvedValue(suspendedTenant);

      const result = await service.validateTenant('test-tenant-id');

      expect(result).toBe(false);
    });

    it('should handle repository errors during tenant validation', async () => {
      const error = new Error('Database error');
      jest.spyOn(service, 'findById').mockRejectedValue(error);

      await expect(service.validateTenant('test-tenant-id')).rejects.toThrow(
        'Database error',
      );
    });
  });

  describe('getallTenants', () => {
    it('should return tenants with user counts', async () => {
      const mockPaginationOptions = {
        limit: 10,
        offset: 0,
        sortBy: 'name' as any,
        order: 'ASC' as any,
      };
      const mockTenantsResult = {
        tenants: [
          {
            id: 'test-tenant-id',
            name: 'Test Tenant',
            code: 'test-tenant',
            description: 'Test tenant description',
            status: TenantStatus.ACTIVE,
            metadata: { key: 'value' },
            settings: { setting: 'value' },
            createdAt: new Date('2023-01-01'),
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'tenant-2',
            name: 'Test Tenant 2',
            code: 'test-tenant-2',
            description: 'Test tenant description 2',
            status: TenantStatus.ACTIVE,
            metadata: { key: 'value' },
            settings: { setting: 'value' },
            createdAt: new Date('2023-01-01'),
            updatedAt: new Date('2023-01-01'),
          },
        ],
        totalCount: 100,
      };

      const mockUserCounts = [
        { tenantId: 'test-tenant-id', userCount: '5' },
        { tenantId: 'tenant-2', userCount: '10' },
      ];

      tenantsRepository.getallTenants.mockResolvedValue(mockTenantsResult);
      userRepository.getUserCount.mockResolvedValue(mockUserCounts);

      const result = await service.getallTenants('test', mockPaginationOptions);

      expect(tenantsRepository.getallTenants).toHaveBeenCalledWith(
        'test',
        mockPaginationOptions,
      );
      expect(userRepository.getUserCount).toHaveBeenCalledWith([
        'test-tenant-id',
        'tenant-2',
      ]);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].userCount).toBe(5);
      expect(result.data[1].userCount).toBe(10);
      expect(result.count).toBe(100);
    });

    it('should return tenants without search filter', async () => {
      const mockTenantsResult = {
        tenants: [mockTenant],
        totalCount: 1,
      };

      const mockUserCounts = [{ tenantId: 'test-tenant-id', userCount: '0' }];

      tenantsRepository.getallTenants.mockResolvedValue(mockTenantsResult);
      userRepository.getUserCount.mockResolvedValue(mockUserCounts);

      const result = await service.getallTenants();

      expect(tenantsRepository.getallTenants).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(result.data[0].userCount).toBe(0);
      expect(result.count).toBe(1);
    });

    it('should return empty result when no tenants exist', async () => {
      const mockTenantsResult = {
        tenants: [],
        totalCount: 0,
      };

      tenantsRepository.getallTenants.mockResolvedValue(mockTenantsResult);

      const result = await service.getallTenants('nonexistent');

      expect(result).toEqual({ data: [], count: 0 });
      expect(userRepository.getUserCount).not.toHaveBeenCalled();
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      tenantsRepository.getallTenants.mockRejectedValue(error);

      await expect(service.getallTenants()).rejects.toThrow('Database error');
    });

    it('should handle tenants with no user count', async () => {
      const mockTenantsResult = {
        tenants: [mockTenant],
        totalCount: 1,
      };

      tenantsRepository.getallTenants.mockResolvedValue(mockTenantsResult);
      userRepository.getUserCount.mockResolvedValue([]);

      const result = await service.getallTenants();

      expect(result.data[0].userCount).toBe(0);
    });
  });

  describe('updateTenant', () => {
    it('should update tenant successfully', async () => {
      const updateDto = {
        description: 'Updated description',
      };
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
      expect(tenantRepository.findOne).not.toHaveBeenCalled();
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
      await expect(
        service.updateTenant('test-tenant-id', updateDto),
      ).rejects.toThrow('Tenant with name "Existing Tenant" already exists');
    });

    it('should throw BadRequestException when code already exists', async () => {
      const updateDto = { code: 'existing-code' };
      const existingTenant = {
        ...mockTenant,
        id: 'different-id',
        code: 'existing-code',
      };

      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant);
      tenantRepository.findOne.mockResolvedValue(existingTenant);

      await expect(
        service.updateTenant('test-tenant-id', updateDto),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateTenant('test-tenant-id', updateDto),
      ).rejects.toThrow('Tenant with code "existing-code" already exists');
    });

    it('should allow updating tenant with same name and code', async () => {
      const updateDto = {
        name: 'Test Tenant',
        code: 'test-tenant',
        description: 'Updated description',
      };
      const updatedTenant = {
        ...mockTenant,
        description: 'Updated description',
      };

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

      expect(tenantRepository.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(updatedTenant);
    });

    it('should handle repository errors during update', async () => {
      const error = new Error('Database error');
      const updateDto = { description: 'Updated' };

      jest.spyOn(service, 'findById').mockResolvedValue(mockTenant);
      tenantRepository.update.mockRejectedValue(error);

      await expect(
        service.updateTenant('test-tenant-id', updateDto),
      ).rejects.toThrow('Database error');
    });

    it('should update both name and code when both are different', async () => {
      const updateDto = { name: 'New Name', code: 'new-code' };
      const updatedTenant = { ...mockTenant, ...updateDto };

      jest
        .spyOn(service, 'findById')
        .mockResolvedValueOnce(mockTenant)
        .mockResolvedValueOnce(updatedTenant);
      tenantRepository.findOne.mockResolvedValue(null);
      tenantRepository.update.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      const result = await service.updateTenant('test-tenant-id', updateDto);

      expect(tenantRepository.findOne).toHaveBeenCalled();
      expect(tenantRepository.update).toHaveBeenCalledWith(
        'test-tenant-id',
        updateDto,
      );
      expect(result).toEqual(updatedTenant);
    });
  });
});
