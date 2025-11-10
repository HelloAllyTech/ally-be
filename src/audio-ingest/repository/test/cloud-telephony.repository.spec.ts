import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CloudTelephonyRepository } from '../cloud-telephony.repository';
import { CloudTelephonyIntegration } from '../../entity/cloud-telephony-integration.entity';
import { CloudTelephonyProvider } from '../../../common/constants/chat.constants';
import { IntegrationStatus } from '../../type/cloud-telephony.type';

describe('CloudTelephonyRepository', () => {
  let repository: CloudTelephonyRepository;
  let dataSource: jest.Mocked<DataSource>;
  let entityManager: jest.Mocked<EntityManager>;
  let mockRepository: jest.Mocked<Repository<CloudTelephonyIntegration>>;

  const mockCloudTelephonyIntegration: CloudTelephonyIntegration = {
    id: 'test-id-123',
    provider: CloudTelephonyProvider.OZONETEL,
    credentials: 'encrypted-credentials',
    status: IntegrationStatus.ACTIVE,
    code: 'TEST_CODE',
    tenantId: 'tenant-123',
    config: { callEventsEnabled: true },
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  };

  const mockCreateData = {
    provider: CloudTelephonyProvider.OZONETEL,
    credentials: 'encrypted-credentials',
    status: IntegrationStatus.ACTIVE,
    code: 'TEST_CODE',
    tenantId: 'tenant-123',
    config: { callEventsEnabled: true },
  };

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as any;

    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue(mockEntityManager),
      getRepository: jest.fn().mockReturnValue(mockRepository),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTelephonyRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<CloudTelephonyRepository>(CloudTelephonyRepository);
    dataSource = module.get(DataSource);
    entityManager = mockEntityManager;

    // Spy on inherited Repository methods
    jest.spyOn(repository, 'create').mockImplementation(mockRepository.create);
    jest.spyOn(repository, 'save').mockImplementation(mockRepository.save);
    jest
      .spyOn(repository, 'findOne')
      .mockImplementation(mockRepository.findOne);
    jest.spyOn(repository, 'update').mockImplementation(mockRepository.update);
    jest.spyOn(repository, 'delete').mockImplementation(mockRepository.delete);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(repository).toBeDefined();
    });

    it('should extend Repository', () => {
      expect(repository).toBeInstanceOf(Repository);
    });
  });

  describe('createIntegration', () => {
    it('should create and save a new cloud telephony integration', async () => {
      const createdEntity = { ...mockCloudTelephonyIntegration };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.createIntegration(mockCreateData);

      expect(dataSource.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(mockRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should create integration with minimal data', async () => {
      const minimalData = {
        provider: CloudTelephonyProvider.OZONETEL,
        credentials: 'encrypted-credentials',
        code: 'MINIMAL_CODE',
        tenantId: 'tenant-123',
      };
      const createdEntity = {
        ...mockCloudTelephonyIntegration,
        ...minimalData,
      };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createIntegration(minimalData);

      expect(mockRepository.create).toHaveBeenCalledWith(minimalData);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });

    it('should create integration with undefined config', async () => {
      const dataWithUndefinedConfig = {
        ...mockCreateData,
        config: undefined,
      };
      const createdEntity = {
        ...mockCloudTelephonyIntegration,
        config: undefined,
      };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createIntegration(
        dataWithUndefinedConfig,
      );

      expect(mockRepository.create).toHaveBeenCalledWith(
        dataWithUndefinedConfig,
      );
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });

    it('should handle TypeORM create errors', async () => {
      const error = new Error('TypeORM create error');
      mockRepository.create.mockImplementation(() => {
        throw error;
      });

      await expect(
        repository.createIntegration(mockCreateData),
      ).rejects.toThrow(error);
      expect(mockRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('should handle TypeORM save errors', async () => {
      const createdEntity = { ...mockCloudTelephonyIntegration };
      const error = new Error('TypeORM save error');
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockRejectedValue(error);

      await expect(
        repository.createIntegration(mockCreateData),
      ).rejects.toThrow(error);
      expect(mockRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
    });

    it('should create integration with empty object', async () => {
      const emptyData = {};
      const createdEntity = { ...mockCloudTelephonyIntegration };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createIntegration(emptyData);

      expect(mockRepository.create).toHaveBeenCalledWith(emptyData);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });
  });

  describe('findById', () => {
    it('should find cloud telephony integration by id', async () => {
      jest
        .spyOn(repository, 'findOne')
        .mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findById('test-id-123');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      const result = await repository.findById('non-existent-id');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
      expect(result).toBeNull();
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        findOne: jest.fn().mockResolvedValue(mockCloudTelephonyIntegration),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.findById('test-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(emRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should handle empty string id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database connection error');
      mockRepository.findOne.mockRejectedValue(error);

      await expect(repository.findById('test-id-123')).rejects.toThrow(error);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
    });

    it('should handle special characters in id', async () => {
      const specialId = 'test-id-with-special-chars-!@#$%^&*()';
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById(specialId);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: specialId },
      });
      expect(result).toBeNull();
    });
  });

  describe('findByCode', () => {
    it('should find cloud telephony integration by code', async () => {
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findByCode('TEST_CODE');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found by code', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('NON_EXISTENT_CODE');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'NON_EXISTENT_CODE' },
      });
      expect(result).toBeNull();
    });

    it('should handle empty string code', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle whitespace-only code', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('   ');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: '   ' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database query error');
      mockRepository.findOne.mockRejectedValue(error);

      await expect(repository.findByCode('TEST_CODE')).rejects.toThrow(error);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
    });

    it('should handle special characters in code', async () => {
      const specialCode = 'TEST_CODE_WITH_SPECIAL_CHARS-!@#$%^&*()';
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findByCode(specialCode);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: specialCode },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should handle case-sensitive code search', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('test_code');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'test_code' },
      });
      expect(result).toBeNull();
    });
  });

  describe('findByTenantId', () => {
    it('should find cloud telephony integration by tenant id', async () => {
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findByTenantId('tenant-123');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found by tenant id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('non-existent-tenant');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'non-existent-tenant' },
      });
      expect(result).toBeNull();
    });

    it('should handle empty string tenant id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle whitespace-only tenant id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('   ');

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: '   ' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database connection error');
      mockRepository.findOne.mockRejectedValue(error);

      await expect(repository.findByTenantId('tenant-123')).rejects.toThrow(
        error,
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
    });

    it('should handle special characters in tenant id', async () => {
      const specialTenantId = 'tenant-with-special-chars-!@#$%^&*()';
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findByTenantId(specialTenantId);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: specialTenantId },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should handle UUID format tenant id', async () => {
      const uuidTenantId = '550e8400-e29b-41d4-a716-446655440000';
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.findByTenantId(uuidTenantId);

      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: uuidTenantId },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });
  });

  describe('updateById', () => {
    it('should update cloud telephony integration by id and return true', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      const result = await repository.updateById('test-id-123', updateData);

      expect(dataSource.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
      expect(result).toBe(true);
    });

    it('should return false when no records are affected', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      mockRepository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: [],
      });

      const result = await repository.updateById('test-id-123', updateData);

      expect(result).toBe(false);
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        update: jest.fn().mockResolvedValue({ affected: 1, raw: {} }),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const updateData = { status: IntegrationStatus.INACTIVE };
      const result = await repository.updateById(
        'test-id-123',
        updateData,
        entityManager,
      );

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(emRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
      expect(result).toBe(true);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should update with partial data', async () => {
      const updateData = { config: { callEventsEnabled: false } };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should update with empty object', async () => {
      const updateData = {};
      mockRepository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should update multiple fields', async () => {
      const updateData = {
        status: IntegrationStatus.INACTIVE,
        config: {
          callEventsEnabled: false,
          webhookUrl: 'https://example.com/webhook',
        },
        credentials: 'new-encrypted-credentials',
      };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle TypeORM errors', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      const error = new Error('Database update error');
      mockRepository.update.mockRejectedValue(error);

      await expect(
        repository.updateById('test-id-123', updateData),
      ).rejects.toThrow(error);
      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle empty string id', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      mockRepository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith('', updateData);
    });

    it('should handle special characters in id', async () => {
      const specialId = 'test-id-with-special-chars-!@#$%^&*()';
      const updateData = { status: IntegrationStatus.INACTIVE };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById(specialId, updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(specialId, updateData);
    });

    it('should handle undefined values in update data', async () => {
      const updateData = {
        config: undefined,
        status: IntegrationStatus.ACTIVE,
      };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });
  });

  describe('deleteById', () => {
    it('should delete cloud telephony integration by id and return true', async () => {
      mockRepository.delete.mockResolvedValue({
        affected: 1,
        raw: {},
      } as any);

      const result = await repository.deleteById('test-id-123');

      expect(dataSource.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(mockRepository.delete).toHaveBeenCalledWith('test-id-123');
      expect(result).toBe(true);
    });

    it('should return false when no records are affected', async () => {
      mockRepository.delete.mockResolvedValue({
        affected: 0,
        raw: {},
      } as any);

      const result = await repository.deleteById('test-id-123');

      expect(result).toBe(false);
    });

    it('should use entity manager if provided', async () => {
      const emRepository = {
        delete: jest.fn().mockResolvedValue({ affected: 1, raw: {} }),
      } as any;

      entityManager.getRepository.mockReturnValue(emRepository);

      const result = await repository.deleteById('test-id-123', entityManager);

      expect(entityManager.getRepository).toHaveBeenCalledWith(
        CloudTelephonyIntegration,
      );
      expect(emRepository.delete).toHaveBeenCalledWith('test-id-123');
      expect(result).toBe(true);
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it('should return true when affected is undefined', async () => {
      mockRepository.delete.mockResolvedValue({ raw: {} } as any);

      const result = await repository.deleteById('test-id-123');

      expect(result).toBe(true);
    });

    it('should handle deletion errors', async () => {
      const error = new Error('Database deletion error');
      mockRepository.delete.mockRejectedValue(error);

      await expect(repository.deleteById('test-id-123')).rejects.toThrow(error);
      expect(mockRepository.delete).toHaveBeenCalledWith('test-id-123');
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete CRUD operations flow', async () => {
      // Create
      const createdEntity = { ...mockCloudTelephonyIntegration };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(mockCloudTelephonyIntegration);

      const createResult = await repository.createIntegration(mockCreateData);
      expect(createResult).toEqual(mockCloudTelephonyIntegration);

      // Find by ID
      mockRepository.findOne.mockResolvedValue(mockCloudTelephonyIntegration);
      const findByIdResult = await repository.findById('test-id-123');
      expect(findByIdResult).toEqual(mockCloudTelephonyIntegration);

      // Find by Code
      const findByCodeResult = await repository.findByCode('TEST_CODE');
      expect(findByCodeResult).toEqual(mockCloudTelephonyIntegration);

      // Find by Tenant ID
      const findByTenantResult = await repository.findByTenantId('tenant-123');
      expect(findByTenantResult).toEqual(mockCloudTelephonyIntegration);

      // Update
      const updateData = { status: IntegrationStatus.INACTIVE };
      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });
      await repository.updateById('test-id-123', updateData);

      expect(mockRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
      expect(mockRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle concurrent operations', async () => {
      // Mock multiple concurrent operations
      mockRepository.findOne
        .mockResolvedValueOnce(mockCloudTelephonyIntegration) // findById
        .mockResolvedValueOnce(mockCloudTelephonyIntegration) // findByCode
        .mockResolvedValueOnce(mockCloudTelephonyIntegration); // findByTenantId

      mockRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      // Execute concurrent operations
      const [findByIdResult, findByCodeResult, findByTenantResult] =
        await Promise.all([
          repository.findById('test-id-123'),
          repository.findByCode('TEST_CODE'),
          repository.findByTenantId('tenant-123'),
        ]);

      expect(findByIdResult).toEqual(mockCloudTelephonyIntegration);
      expect(findByCodeResult).toEqual(mockCloudTelephonyIntegration);
      expect(findByTenantResult).toEqual(mockCloudTelephonyIntegration);

      // Update operation
      await repository.updateById('test-id-123', {
        status: IntegrationStatus.INACTIVE,
      });

      expect(mockRepository.findOne).toHaveBeenCalledTimes(3);
      expect(mockRepository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database connection timeout', async () => {
      const timeoutError = new Error('Connection timeout');
      mockRepository.findOne.mockRejectedValue(timeoutError);

      await expect(repository.findById('test-id-123')).rejects.toThrow(
        timeoutError,
      );
    });

    it('should handle constraint violation errors', async () => {
      const constraintError = new Error('Unique constraint violation');
      mockRepository.create.mockReturnValue(mockCloudTelephonyIntegration);
      mockRepository.save.mockRejectedValue(constraintError);

      await expect(
        repository.createIntegration(mockCreateData),
      ).rejects.toThrow(constraintError);
    });

    it('should handle malformed data gracefully', async () => {
      const malformedData = {
        provider: 'INVALID_PROVIDER' as any,
        credentials: 'valid-credentials',
        code: 'VALID_CODE',
        tenantId: 'valid-tenant',
      };

      const createdEntity = {
        ...mockCloudTelephonyIntegration,
        ...malformedData,
      };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createIntegration(malformedData);
      expect(result).toEqual(createdEntity);
    });

    it('should handle very long strings', async () => {
      const longString = 'a'.repeat(10000);
      const dataWithLongString = {
        ...mockCreateData,
        credentials: longString,
        code: longString,
      };

      const createdEntity = {
        ...mockCloudTelephonyIntegration,
        ...dataWithLongString,
      };
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createIntegration(dataWithLongString);
      expect(result).toEqual(createdEntity);
    });
  });
});
