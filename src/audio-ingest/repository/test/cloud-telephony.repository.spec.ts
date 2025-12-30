import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CloudTelephonyRepository } from '../cloud-telephony.repository';
import { CloudTelephonyIntegration } from '../../entity/cloud-telephony-integration.entity';
import { CloudTelephonyProvider } from '../../../common/constants/chat.constants';
import { IntegrationStatus } from '../../type/cloud-telephony.type';

describe('CloudTelephonyRepository', () => {
  let repository: CloudTelephonyRepository;
  let typeOrmRepository: jest.Mocked<Repository<CloudTelephonyIntegration>>;

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
    const mockTypeOrmRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudTelephonyRepository,
        {
          provide: getRepositoryToken(CloudTelephonyIntegration),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<CloudTelephonyRepository>(CloudTelephonyRepository);
    typeOrmRepository = module.get(
      getRepositoryToken(CloudTelephonyIntegration),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create and save a new cloud telephony integration', async () => {
      const createdEntity = { ...mockCloudTelephonyIntegration };
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(mockCloudTelephonyIntegration);

      const result = await repository.create(mockCreateData);

      expect(typeOrmRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
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
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.create(minimalData);

      expect(typeOrmRepository.create).toHaveBeenCalledWith(minimalData);
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
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
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.create(dataWithUndefinedConfig);

      expect(typeOrmRepository.create).toHaveBeenCalledWith(
        dataWithUndefinedConfig,
      );
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });

    it('should handle TypeORM create errors', async () => {
      const error = new Error('TypeORM create error');
      typeOrmRepository.create.mockImplementation(() => {
        throw error;
      });

      await expect(repository.create(mockCreateData)).rejects.toThrow(error);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(typeOrmRepository.save).not.toHaveBeenCalled();
    });

    it('should handle TypeORM save errors', async () => {
      const createdEntity = { ...mockCloudTelephonyIntegration };
      const error = new Error('TypeORM save error');
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockRejectedValue(error);

      await expect(repository.create(mockCreateData)).rejects.toThrow(error);
      expect(typeOrmRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
    });

    it('should create integration with empty object', async () => {
      const emptyData = {};
      const createdEntity = { ...mockCloudTelephonyIntegration };
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.create(emptyData);

      expect(typeOrmRepository.create).toHaveBeenCalledWith(emptyData);
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });
  });

  describe('findById', () => {
    it('should find cloud telephony integration by id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findById('test-id-123');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent-id');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
      expect(result).toBeNull();
    });

    it('should handle empty string id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database connection error');
      typeOrmRepository.findOne.mockRejectedValue(error);

      await expect(repository.findById('test-id-123')).rejects.toThrow(error);
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
    });

    it('should handle special characters in id', async () => {
      const specialId = 'test-id-with-special-chars-!@#$%^&*()';
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById(specialId);

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: specialId },
      });
      expect(result).toBeNull();
    });
  });

  describe('findByCode', () => {
    it('should find cloud telephony integration by code', async () => {
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findByCode('TEST_CODE');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found by code', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('NON_EXISTENT_CODE');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'NON_EXISTENT_CODE' },
      });
      expect(result).toBeNull();
    });

    it('should handle empty string code', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle whitespace-only code', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('   ');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: '   ' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database query error');
      typeOrmRepository.findOne.mockRejectedValue(error);

      await expect(repository.findByCode('TEST_CODE')).rejects.toThrow(error);
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
    });

    it('should handle special characters in code', async () => {
      const specialCode = 'TEST_CODE_WITH_SPECIAL_CHARS-!@#$%^&*()';
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findByCode(specialCode);

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: specialCode },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should handle case-sensitive code search', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByCode('test_code');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'test_code' },
      });
      expect(result).toBeNull();
    });
  });

  describe('findByTenantId', () => {
    it('should find cloud telephony integration by tenant id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findByTenantId('tenant-123');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should return null when integration is not found by tenant id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('non-existent-tenant');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'non-existent-tenant' },
      });
      expect(result).toBeNull();
    });

    it('should handle empty string tenant id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: '' },
      });
      expect(result).toBeNull();
    });

    it('should handle whitespace-only tenant id', async () => {
      typeOrmRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByTenantId('   ');

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: '   ' },
      });
      expect(result).toBeNull();
    });

    it('should handle TypeORM errors', async () => {
      const error = new Error('Database connection error');
      typeOrmRepository.findOne.mockRejectedValue(error);

      await expect(repository.findByTenantId('tenant-123')).rejects.toThrow(
        error,
      );
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
    });

    it('should handle special characters in tenant id', async () => {
      const specialTenantId = 'tenant-with-special-chars-!@#$%^&*()';
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findByTenantId(specialTenantId);

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: specialTenantId },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });

    it('should handle UUID format tenant id', async () => {
      const uuidTenantId = '550e8400-e29b-41d4-a716-446655440000';
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );

      const result = await repository.findByTenantId(uuidTenantId);

      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: uuidTenantId },
      });
      expect(result).toEqual(mockCloudTelephonyIntegration);
    });
  });

  describe('updateById', () => {
    it('should update cloud telephony integration by id', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should update with partial data', async () => {
      const updateData = { config: { callEventsEnabled: false } };
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should update with empty object', async () => {
      const updateData = {};
      typeOrmRepository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
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
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle TypeORM errors', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      const error = new Error('Database update error');
      typeOrmRepository.update.mockRejectedValue(error);

      await expect(
        repository.updateById('test-id-123', updateData),
      ).rejects.toThrow(error);
      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle empty string id', async () => {
      const updateData = { status: IntegrationStatus.INACTIVE };
      typeOrmRepository.update.mockResolvedValue({
        affected: 0,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith('', updateData);
    });

    it('should handle special characters in id', async () => {
      const specialId = 'test-id-with-special-chars-!@#$%^&*()';
      const updateData = { status: IntegrationStatus.INACTIVE };
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById(specialId, updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        specialId,
        updateData,
      );
    });

    it('should handle undefined values in update data', async () => {
      const updateData = {
        config: undefined,
        status: IntegrationStatus.ACTIVE,
      };
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });

      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete CRUD operations flow', async () => {
      // Create
      const createdEntity = { ...mockCloudTelephonyIntegration };
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(mockCloudTelephonyIntegration);

      const createResult = await repository.create(mockCreateData);
      expect(createResult).toEqual(mockCloudTelephonyIntegration);

      // Find by ID
      typeOrmRepository.findOne.mockResolvedValue(
        mockCloudTelephonyIntegration,
      );
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
      typeOrmRepository.update.mockResolvedValue({
        affected: 1,
        generatedMaps: [],
        raw: [],
      });
      await repository.updateById('test-id-123', updateData);

      expect(typeOrmRepository.create).toHaveBeenCalledWith(mockCreateData);
      expect(typeOrmRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-id-123' },
      });
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { code: 'TEST_CODE' },
      });
      expect(typeOrmRepository.findOne).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-123' },
      });
      expect(typeOrmRepository.update).toHaveBeenCalledWith(
        'test-id-123',
        updateData,
      );
    });

    it('should handle concurrent operations', async () => {
      // Mock multiple concurrent operations
      typeOrmRepository.findOne
        .mockResolvedValueOnce(mockCloudTelephonyIntegration) // findById
        .mockResolvedValueOnce(mockCloudTelephonyIntegration) // findByCode
        .mockResolvedValueOnce(mockCloudTelephonyIntegration); // findByTenantId

      typeOrmRepository.update.mockResolvedValue({
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

      expect(typeOrmRepository.findOne).toHaveBeenCalledTimes(3);
      expect(typeOrmRepository.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle database connection timeout', async () => {
      const timeoutError = new Error('Connection timeout');
      typeOrmRepository.findOne.mockRejectedValue(timeoutError);

      await expect(repository.findById('test-id-123')).rejects.toThrow(
        timeoutError,
      );
    });

    it('should handle constraint violation errors', async () => {
      const constraintError = new Error('Unique constraint violation');
      typeOrmRepository.create.mockReturnValue(mockCloudTelephonyIntegration);
      typeOrmRepository.save.mockRejectedValue(constraintError);

      await expect(repository.create(mockCreateData)).rejects.toThrow(
        constraintError,
      );
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
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.create(malformedData);
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
      typeOrmRepository.create.mockReturnValue(createdEntity);
      typeOrmRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.create(dataWithLongString);
      expect(result).toEqual(createdEntity);
    });
  });
});
